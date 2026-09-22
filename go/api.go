package iforevents

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	userKey        = "iforevents_user_id"
	identifiedKey  = "iforevents_user_identified"
	queueKey       = "iforevents_queue"
	maxBatch       = 500
	defaultBaseURL = "https://api.iforevents.com"
)

// APIConfig configures the first-party API integration.
//
// Only ProjectKey is required. It is a public write key: it grants event
// ingestion and nothing else, so embedding it in a binary is safe. There is
// deliberately no project secret here.
type APIConfig struct {
	ProjectKey string
	// BaseURL of the api. Default https://api.iforevents.com.
	BaseURL string
	// BatchSize is the number of events per request (1..500). 1 disables batching. Default 10.
	BatchSize int
	// FlushInterval is how long a partial batch waits. Default 5s.
	FlushInterval time.Duration
	// Timeout per request. Default 10s.
	Timeout time.Duration
	// MaxRetries for transient failures. Default 3. Use a negative value for none.
	MaxRetries int
	// RetryDelay base, multiplied by the attempt number. Default 1s.
	RetryDelay time.Duration
	// DisableRequeue drops events that failed with a transient error instead of keeping them.
	DisableRequeue bool
	// Debug logs requests and failures through Logger.
	Debug bool
	// ReturnErrors makes Identify, Flush and Reset return the request error instead of only reporting it.
	ReturnErrors bool
	// OnQuotaExceeded is called once when the api starts refusing events with quota_exceeded, and again after a later success followed by a new refusal.
	OnQuotaExceeded func(*QuotaExceededError)
	// OnError is called for every failed request after retries are exhausted.
	OnError func(error)
	// Storage keeps the user uuid (and the queue with PersistQueue). Default in-memory.
	Storage Storage
	// PersistQueue stores the pending queue in Storage so unsent events survive a restart.
	PersistQueue bool
	// MaxQueueSize bounds the queue. Default 1000.
	MaxQueueSize int
	// HTTPClient to use; Timeout is applied per request through the context.
	HTTPClient *http.Client
	// UserAgent header. Default iforevents-go/<version> go/<version> (<os>; <arch>).
	UserAgent string
	Logger    *log.Logger
	Hooks     Hooks
}

type queuedEvent struct {
	Name       string     `json:"name"`
	Type       string     `json:"type"`
	Properties Properties `json:"properties"`
	CreatedAt  string     `json:"created_at"`
}

// APIIntegration talks to the IForevents ingest api. Safe for concurrent use.
type APIIntegration struct {
	BaseIntegration
	cfg     APIConfig
	client  *http.Client
	storage Storage

	mu            sync.Mutex
	queue         []queuedEvent
	timer         *time.Timer
	sendMu        sync.Mutex
	userID        string
	initialized   bool
	identified    bool
	quotaExceeded bool
}

// NewAPIIntegration validates the config and applies defaults.
func NewAPIIntegration(cfg APIConfig) (*APIIntegration, error) {
	if strings.TrimSpace(cfg.ProjectKey) == "" {
		return nil, errors.New("iforevents: APIConfig.ProjectKey is required")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL
	}
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 10
	}
	if cfg.BatchSize > maxBatch {
		cfg.BatchSize = maxBatch
	}
	if cfg.FlushInterval == 0 {
		cfg.FlushInterval = 5 * time.Second
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	}
	if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 0
	}
	if cfg.RetryDelay == 0 {
		cfg.RetryDelay = time.Second
	}
	if cfg.MaxQueueSize <= 0 {
		cfg.MaxQueueSize = 1000
	}
	if cfg.UserAgent == "" {
		cfg.UserAgent = fmt.Sprintf("%s/%s go/%s (%s; %s)", SDKName, SDKVersion, runtime.Version(), runtime.GOOS, runtime.GOARCH)
	}
	if cfg.Logger == nil {
		cfg.Logger = log.Default()
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	storage := cfg.Storage
	if storage == nil {
		storage = NewMemoryStorage()
	}
	return &APIIntegration{
		BaseIntegration: BaseIntegration{IntegrationName: "IForeventsAPIIntegration", Hooks: cfg.Hooks},
		cfg:             cfg,
		client:          client,
		storage:         storage,
	}, nil
}

// MustAPIIntegration panics on an invalid config; for package-level vars.
func MustAPIIntegration(cfg APIConfig) *APIIntegration {
	i, err := NewAPIIntegration(cfg)
	if err != nil {
		panic(err)
	}
	return i
}

// --- state -------------------------------------------------------------------

func (a *APIIntegration) IsInitialized() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.initialized }
func (a *APIIntegration) IsIdentified() bool  { a.mu.Lock(); defer a.mu.Unlock(); return a.identified }

// UserID is the id every request carries in X-User-Id: a generated anon_...
// id kept per visitor, or the CustomID of the last Identify.
func (a *APIIntegration) UserID() string { a.mu.Lock(); defer a.mu.Unlock(); return a.userID }

func (a *APIIntegration) QueuedEvents() int { a.mu.Lock(); defer a.mu.Unlock(); return len(a.queue) }

// IsQuotaExceeded is true after a quota_exceeded answer until the next accepted request.
func (a *APIIntegration) IsQuotaExceeded() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.quotaExceeded
}

// --- Integration -------------------------------------------------------------

func (a *APIIntegration) Init(ctx context.Context) error {
	if err := a.BaseIntegration.Init(ctx); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if v, ok := a.storage.Get(userKey); ok && v != "" {
		a.userID = v
		flag, _ := a.storage.Get(identifiedKey)
		a.identified = flag == "true"
	} else {
		// A fresh visitor: attribute everything to an anonymous id we own, so the
		// api never has to fingerprint the address (which merges users behind a NAT).
		a.setUserLocked(AnonymousID(), false)
	}
	if a.cfg.PersistQueue {
		if raw, ok := a.storage.Get(queueKey); ok && raw != "" {
			var events []queuedEvent
			if err := json.Unmarshal([]byte(raw), &events); err == nil && len(events) > 0 {
				a.queue = append(events, a.queue...)
				a.trimLocked()
				a.scheduleLocked()
			} else {
				_ = a.storage.Remove(queueKey)
			}
		}
	}
	a.initialized = true
	a.debugf("api integration ready base_url=%s batch_size=%d", a.cfg.BaseURL, a.cfg.BatchSize)
	return nil
}

func (a *APIIntegration) Identify(ctx context.Context, event IdentifyEvent) error {
	if err := a.BaseIntegration.Identify(ctx, event); err != nil {
		return err
	}
	properties := Properties{}
	body := map[string]any{"custom_id": event.CustomID}
	for k, v := range event.Traits {
		switch k {
		case "email", "name", "phone_number":
			if s, ok := v.(string); ok && s != "" {
				body[k] = s
				continue
			}
		}
		properties[k] = v
	}
	body["properties"] = properties
	// Attribute from now on, even if the profile request itself fails: the
	// api creates the profile on the first event it sees for this id.
	a.setUser(event.CustomID, true)
	if _, err := a.request(ctx, "/v1/events/identify", body); err != nil {
		return a.fail(err)
	}
	return nil
}

func (a *APIIntegration) Track(ctx context.Context, event TrackEvent) error {
	if err := a.BaseIntegration.Track(ctx, event); err != nil {
		return err
	}
	ts := event.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	typ := event.Type
	if typ == "" {
		typ = EventTypeTrack
	}
	props := event.Properties
	if props == nil {
		props = Properties{}
	}
	q := queuedEvent{Name: event.Name, Type: typ, Properties: props, CreatedAt: ts.UTC().Format(time.RFC3339Nano)}
	if a.cfg.BatchSize <= 1 {
		if _, err := a.request(ctx, "/v1/events/track", map[string]any{"event_name": q.Name, "event_type": q.Type, "properties": q.Properties}); err != nil {
			return a.fail(err)
		}
		return nil
	}
	a.mu.Lock()
	a.queue = append(a.queue, q)
	a.trimLocked()
	full := len(a.queue) >= a.cfg.BatchSize
	a.persistLocked()
	if !full {
		a.scheduleLocked()
	}
	a.mu.Unlock()
	if full {
		return a.Flush(ctx)
	}
	return nil
}

func (a *APIIntegration) Page(ctx context.Context, event PageEvent) error {
	if err := a.BaseIntegration.Page(ctx, event); err != nil {
		return err
	}
	props := Properties{}
	for k, v := range event.Properties {
		props[k] = v
	}
	if event.NavigationType != "" {
		props["navigation_type"] = event.NavigationType
	}
	if event.ToRoute != "" {
		props["to_route"] = event.ToRoute
	}
	if event.PreviousRoute != "" {
		props["previous_route"] = event.PreviousRoute
	}
	name := event.Name
	if name == "" {
		name = "page_view"
	}
	return a.Track(ctx, TrackEvent{Name: name, Type: EventTypePageView, Properties: props, Timestamp: event.Timestamp})
}

func (a *APIIntegration) Reset(ctx context.Context) error {
	if err := a.BaseIntegration.Reset(ctx); err != nil {
		return err
	}
	err := a.Flush(ctx)
	// Forget the person; the next events belong to a fresh anonymous id.
	a.setUser(AnonymousID(), false)
	return err
}

// Flush sends the whole queue now, 500 events per request, and blocks until done.
func (a *APIIntegration) Flush(ctx context.Context) error {
	a.mu.Lock()
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
	a.mu.Unlock()

	a.sendMu.Lock()
	defer a.sendMu.Unlock()
	for {
		a.mu.Lock()
		if len(a.queue) == 0 {
			a.mu.Unlock()
			return nil
		}
		n := len(a.queue)
		if n > maxBatch {
			n = maxBatch
		}
		events := make([]queuedEvent, n)
		copy(events, a.queue[:n])
		a.queue = a.queue[n:]
		a.mu.Unlock()

		_, err := a.request(ctx, "/v1/events/batch", map[string]any{"events": events})
		if err != nil {
			a.mu.Lock()
			var r retryable
			transient := !errors.As(err, &r) || r.Retryable()
			if transient && !a.cfg.DisableRequeue {
				// Transient: keep these events at the front for the next flush.
				a.queue = append(events, a.queue...)
				a.scheduleLocked()
			} else if !transient {
				// A refused key or an exhausted quota fails the same way forever: drop everything.
				a.queue = nil
			}
			a.persistLocked()
			a.mu.Unlock()
			return a.fail(err)
		}
		a.mu.Lock()
		a.persistLocked()
		a.mu.Unlock()
	}
}

func (a *APIIntegration) Shutdown(ctx context.Context) error {
	err := a.Flush(ctx)
	a.mu.Lock()
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
	a.mu.Unlock()
	return err
}

// --- internals -----------------------------------------------------------------

func (a *APIIntegration) trimLocked() {
	if over := len(a.queue) - a.cfg.MaxQueueSize; over > 0 {
		a.queue = a.queue[over:]
	}
}

func (a *APIIntegration) scheduleLocked() {
	if a.timer != nil || len(a.queue) == 0 {
		return
	}
	a.timer = time.AfterFunc(a.cfg.FlushInterval, func() {
		a.mu.Lock()
		a.timer = nil
		a.mu.Unlock()
		_ = a.Flush(context.Background())
	})
}

func (a *APIIntegration) persistLocked() {
	if !a.cfg.PersistQueue {
		return
	}
	if len(a.queue) == 0 {
		_ = a.storage.Remove(queueKey)
		return
	}
	if raw, err := json.Marshal(a.queue); err == nil {
		_ = a.storage.Set(queueKey, string(raw))
	}
}

func (a *APIIntegration) setUser(id string, identified bool) {
	a.mu.Lock()
	a.setUserLocked(id, identified)
	a.mu.Unlock()
}

func (a *APIIntegration) setUserLocked(id string, identified bool) {
	a.userID = id
	a.identified = identified
	_ = a.storage.Set(userKey, id)
	flag := "false"
	if identified {
		flag = "true"
	}
	_ = a.storage.Set(identifiedKey, flag)
}

// AnonymousID returns a fresh anonymous id, unrelated to anything the server
// derives: anon_<uuid4 without dashes>.
func AnonymousID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Extremely unlikely; fall back to time so the id is still unique enough.
		copy(b, []byte(fmt.Sprintf("%016d", time.Now().UnixNano())))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return "anon_" + hex.EncodeToString(b)
}

func (a *APIIntegration) fail(err error) error {
	a.debugf("request failed: %v", err)
	if a.cfg.OnError != nil {
		a.cfg.OnError(err)
	}
	if a.cfg.ReturnErrors {
		return err
	}
	return nil
}

func (a *APIIntegration) noteOutcome(err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var quota *QuotaExceededError
	switch {
	case err == nil:
		a.quotaExceeded = false
	case errors.As(err, &quota):
		if !a.quotaExceeded {
			a.quotaExceeded = true
			if a.cfg.OnQuotaExceeded != nil {
				a.cfg.OnQuotaExceeded(quota)
			}
		}
	}
}

func (a *APIIntegration) debugf(format string, args ...any) {
	if a.cfg.Debug {
		a.cfg.Logger.Printf("[iforevents] "+format, args...)
	}
}

// request POSTs JSON with retries and returns the decoded body.
func (a *APIIntegration) request(ctx context.Context, path string, body any) (map[string]any, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, &APIError{Message: "encode request: " + err.Error(), Cause: err}
	}
	a.mu.Lock()
	userID := a.userID
	a.mu.Unlock()

	for attempt := 0; ; attempt++ {
		res, err := a.once(ctx, path, payload, userID)
		if err == nil {
			a.noteOutcome(nil)
			return res, nil
		}
		var r retryable
		canRetry := errors.As(err, &r) && r.Retryable()
		if !canRetry || attempt >= a.cfg.MaxRetries {
			a.noteOutcome(err)
			return nil, err
		}
		delay := a.cfg.RetryDelay * time.Duration(attempt+1)
		var rl *RateLimitedError
		if errors.As(err, &rl) && rl.RetryAfter > 0 {
			delay = rl.RetryAfter
		}
		a.debugf("retrying %s in %s (%d/%d)", path, delay, attempt+1, a.cfg.MaxRetries)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, &APIError{Message: ctx.Err().Error(), Cause: ctx.Err()}
		}
	}
}

func (a *APIIntegration) once(ctx context.Context, path string, payload []byte, userID string) (map[string]any, error) {
	reqCtx, cancel := context.WithTimeout(ctx, a.cfg.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, a.cfg.BaseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, &APIError{Message: err.Error(), Cause: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Project-Key", a.cfg.ProjectKey)
	req.Header.Set("User-Agent", a.cfg.UserAgent)
	if userID != "" {
		req.Header.Set("X-User-Id", userID)
	}
	res, err := a.client.Do(req)
	if err != nil {
		return nil, &APIError{Message: err.Error(), Cause: err}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	a.debugf("POST %s -> %d", path, res.StatusCode)
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		out := map[string]any{}
		_ = json.Unmarshal(raw, &out)
		return out, nil
	}
	return nil, classifyResponse(res.StatusCode, raw, res.Header.Get("Retry-After"))
}
