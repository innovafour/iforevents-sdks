package iforevents_test

// Conformance suite for sdks/CONTRACT.md section 8; each test names its item.

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	iforevents "github.com/innovafour/iforevents-go"
	"github.com/innovafour/iforevents-go/internal/testapi"
)

var anonRe = regexp.MustCompile(`^anon_[0-9a-f]{32}$`)

var ctx = context.Background()

func newAPI(t *testing.T, srv *testapi.Server, mutate func(*iforevents.APIConfig)) *iforevents.APIIntegration {
	t.Helper()
	cfg := iforevents.APIConfig{ProjectKey: "pk_test", BaseURL: srv.URL, RetryDelay: 10 * time.Millisecond, FlushInterval: 60 * time.Millisecond}
	if mutate != nil {
		mutate(&cfg)
	}
	api, err := iforevents.NewAPIIntegration(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return api
}

func boot(t *testing.T, srv *testapi.Server, mutate func(*iforevents.APIConfig), extra ...iforevents.Integration) (*iforevents.Client, *iforevents.APIIntegration) {
	t.Helper()
	api := newAPI(t, srv, mutate)
	all := append([]iforevents.Integration{api}, extra...)
	c := iforevents.New(iforevents.WithIntegrations(all...), iforevents.WithContext(func() iforevents.Properties {
		return iforevents.Properties{"device_platform": "test", "sdk_name": "iforevents-go"}
	}))
	c.Init(ctx)
	t.Cleanup(func() { c.Shutdown(ctx) })
	return c, api
}

func names(reqs []testapi.Request, i int) []string {
	events, _ := reqs[i].Body["events"].([]any)
	var out []string
	for _, e := range events {
		m := e.(map[string]any)
		out = append(out, m["name"].(string))
	}
	return out
}

func TestConformance(t *testing.T) {
	srv := testapi.New()
	defer srv.Close()

	t.Run("01 identify lifts fields, sends properties, switches X-User-Id to the customId", func(t *testing.T) {
		srv.Reset()
		c, api := boot(t, srv, nil)
		c.Identify(ctx, "user_1", iforevents.Properties{"email": "ada@example.com", "name": "Ada", "phone_number": "+1", "plan": "pro", "nested": map[string]any{"a": 1}})
		req := srv.ByPath("/v1/events/identify")[0]
		if req.Headers.Get("X-Project-Key") != "pk_test" || req.Headers.Get("Content-Type") != "application/json" || !strings.HasPrefix(req.Headers.Get("User-Agent"), "iforevents-go/") {
			t.Fatalf("headers: %v", req.Headers)
		}
		if req.Body["custom_id"] != "user_1" || req.Body["email"] != "ada@example.com" || req.Body["name"] != "Ada" || req.Body["phone_number"] != "+1" {
			t.Fatalf("body: %v", req.Body)
		}
		props := req.Body["properties"].(map[string]any)
		if props["plan"] != "pro" || props["nested_a"] != float64(1) || props["device_platform"] != "test" || props["email"] != nil {
			t.Fatalf("properties: %v", props)
		}
		if req.Headers.Get("X-User-Id") != "user_1" || api.UserID() != "user_1" || !api.IsIdentified() {
			t.Fatalf("user id %q identified %v", api.UserID(), api.IsIdentified())
		}
	})

	t.Run("02 track after identify carries X-User-Id and merged traits", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1 })
		c.Identify(ctx, "user_1", iforevents.Properties{"plan": "pro"})
		c.Track(ctx, "clicked", iforevents.Properties{"button": "buy", "plan": "override"})
		req := srv.ByPath("/v1/events/track")[0]
		if req.Headers.Get("X-User-Id") != "user_1" {
			t.Fatalf("user id header: %v", req.Headers)
		}
		props := req.Body["properties"].(map[string]any)
		if req.Body["event_name"] != "clicked" || req.Body["event_type"] != "track" || props["plan"] != "override" || props["button"] != "buy" || props["device_platform"] != "test" {
			t.Fatalf("body: %v", req.Body)
		}
	})

	t.Run("03 batchSize N sends one /batch with N events on the Nth", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 3; c.FlushInterval = 10 * time.Second })
		c.Track(ctx, "a", nil)
		c.Track(ctx, "b", nil)
		time.Sleep(20 * time.Millisecond)
		if len(srv.Requests()) != 0 {
			t.Fatal("sent early")
		}
		c.Track(ctx, "c", nil)
		batches := srv.ByPath("/v1/events/batch")
		if len(batches) != 1 || strings.Join(names(batches, 0), ",") != "a,b,c" {
			t.Fatalf("batches: %v", batches)
		}
		for _, e := range batches[0].Body["events"].([]any) {
			m := e.(map[string]any)
			if m["type"] != "track" {
				t.Fatalf("type: %v", m)
			}
			if _, err := time.Parse(time.RFC3339Nano, m["created_at"].(string)); err != nil {
				t.Fatalf("created_at: %v", err)
			}
		}
	})

	t.Run("04 flushInterval elapses: partial queue sent", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 50; c.FlushInterval = 50 * time.Millisecond })
		c.Track(ctx, "only", nil)
		if len(srv.Requests()) != 0 {
			t.Fatal("sent early")
		}
		time.Sleep(200 * time.Millisecond)
		if len(srv.ByPath("/v1/events/batch")) != 1 {
			t.Fatalf("expected timer flush: %v", srv.Requests())
		}
	})

	t.Run("05 batchSize 1 posts /track with event_type", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1 })
		c.Track(ctx, "solo", iforevents.Properties{"n": 1})
		req := srv.ByPath("/v1/events/track")[0]
		if req.Body["event_type"] != "track" || req.Body["event_name"] != "solo" {
			t.Fatalf("body: %v", req.Body)
		}
	})

	t.Run("06 page view has page_view type and navigation fields", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1 })
		c.Page(ctx, "/pricing", iforevents.Properties{"title": "Pricing"}, iforevents.PageOptions{NavigationType: "push", PreviousRoute: "/"})
		req := srv.ByPath("/v1/events/track")[0]
		props := req.Body["properties"].(map[string]any)
		if req.Body["event_name"] != "/pricing" || req.Body["event_type"] != "page_view" || props["title"] != "Pricing" || props["navigation_type"] != "push" || props["previous_route"] != "/" {
			t.Fatalf("body: %v", req.Body)
		}
	})

	t.Run("07 anonymous id generated, persisted and reused by a new instance", func(t *testing.T) {
		srv.Reset()
		storage := iforevents.NewMemoryStorage()
		c, api := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1; c.Storage = storage })
		c.Track(ctx, "first", nil)
		c.Track(ctx, "second", nil)
		reqs := srv.ByPath("/v1/events/track")
		anon := reqs[0].Headers.Get("X-User-Id")
		if !anonRe.MatchString(anon) || reqs[1].Headers.Get("X-User-Id") != anon {
			t.Fatalf("headers: %v / %v", reqs[0].Headers, reqs[1].Headers)
		}
		if v, _ := storage.Get("iforevents_user_id"); v != anon || api.UserID() != anon || api.IsIdentified() {
			t.Fatalf("stored %q api %q identified %v", v, api.UserID(), api.IsIdentified())
		}
		if v, _ := storage.Get("iforevents_user_identified"); v != "false" {
			t.Fatalf("identified flag %q", v)
		}
		again := newAPI(t, srv, func(c *iforevents.APIConfig) { c.Storage = storage })
		_ = again.Init(ctx)
		if again.UserID() != anon {
			t.Fatalf("resumed %q", again.UserID())
		}
		other := newAPI(t, srv, nil)
		_ = other.Init(ctx)
		if !anonRe.MatchString(other.UserID()) || other.UserID() == anon {
			t.Fatalf("other visitor %q", other.UserID())
		}
	})

	t.Run("08 reset flushes, then switches to a fresh anonymous id", func(t *testing.T) {
		srv.Reset()
		storage := iforevents.NewMemoryStorage()
		c, api := boot(t, srv, func(c *iforevents.APIConfig) {
			c.BatchSize = 10
			c.FlushInterval = 10 * time.Second
			c.Storage = storage
		})
		c.Identify(ctx, "user_1", nil)
		c.Track(ctx, "before_logout", nil)
		c.Reset(ctx)
		batches := srv.ByPath("/v1/events/batch")
		if len(batches) != 1 || batches[0].Headers.Get("X-User-Id") != "user_1" {
			t.Fatalf("batches: %v", batches)
		}
		if !anonRe.MatchString(api.UserID()) || api.IsIdentified() || len(c.CurrentTraits()) != 0 {
			t.Fatalf("after reset: %q %v", api.UserID(), api.IsIdentified())
		}
		if v, _ := storage.Get("iforevents_user_id"); v != api.UserID() {
			t.Fatalf("stored %q", v)
		}
		c.Track(ctx, "after_logout", nil)
		c.Flush(ctx)
		if got := srv.ByPath("/v1/events/batch")[1].Headers.Get("X-User-Id"); got != api.UserID() || got == "user_1" {
			t.Fatalf("after reset header %q", got)
		}
	})

	t.Run("09 500 then 200: same events retried and delivered once", func(t *testing.T) {
		srv.Reset()
		failures := 0
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			if req.Path == "/v1/events/batch" && failures < 1 {
				failures++
				return testapi.JSON(w, 500, map[string]any{"error": "boom"}, nil)
			}
			return false
		})
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 2; c.MaxRetries = 2 })
		c.Track(ctx, "x", nil)
		c.Track(ctx, "y", nil)
		c.Flush(ctx)
		batches := srv.ByPath("/v1/events/batch")
		if len(batches) != 2 || strings.Join(names(batches, 1), ",") != "x,y" {
			t.Fatalf("batches: %d %v", len(batches), batches)
		}
	})

	t.Run("10 quota_exceeded: no retry, dropped, callback once, flag until next success", func(t *testing.T) {
		srv.Reset()
		refuse := true
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			if req.Path == "/v1/events/batch" && refuse {
				return testapi.JSON(w, 429, map[string]any{"error": "quota_exceeded", "message": "plan quota exhausted", "limit": 5000000, "used": 5000001, "org_uuid": "org-1"}, nil)
			}
			return false
		})
		var seen []*iforevents.QuotaExceededError
		c, api := boot(t, srv, func(c *iforevents.APIConfig) {
			c.BatchSize = 500
			c.OnQuotaExceeded = func(e *iforevents.QuotaExceededError) { seen = append(seen, e) }
		})
		c.Track(ctx, "a", nil)
		c.Flush(ctx)
		c.Track(ctx, "b", nil)
		c.Flush(ctx)
		if len(srv.ByPath("/v1/events/batch")) != 2 || len(seen) != 1 || seen[0].Limit != 5000000 || seen[0].Used != 5000001 || seen[0].OrganizationUUID != "org-1" {
			t.Fatalf("seen %v batches %d", seen, len(srv.ByPath("/v1/events/batch")))
		}
		if !api.IsQuotaExceeded() || api.QueuedEvents() != 0 {
			t.Fatal("flag/queue wrong")
		}
		refuse = false
		c.Track(ctx, "c", nil)
		c.Flush(ctx)
		last := srv.ByPath("/v1/events/batch")
		if api.IsQuotaExceeded() || strings.Join(names(last, len(last)-1), ",") != "c" {
			t.Fatal("did not recover")
		}
	})

	t.Run("11 rate limit with Retry-After retried after the header delay", func(t *testing.T) {
		srv.Reset()
		limited := true
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			if req.Path == "/v1/events/batch" && limited {
				limited = false
				return testapi.JSON(w, 429, map[string]any{"error": "ingest_rate_limit_exceeded", "retry_after_seconds": 1}, map[string]string{"Retry-After": "1"})
			}
			return false
		})
		var errs []error
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 500; c.OnError = func(e error) { errs = append(errs, e) } })
		c.Track(ctx, "r", nil)
		started := time.Now()
		c.Flush(ctx)
		if time.Since(started) < 950*time.Millisecond || len(srv.ByPath("/v1/events/batch")) != 2 || len(errs) != 0 {
			t.Fatalf("elapsed %s batches %d errs %v", time.Since(started), len(srv.ByPath("/v1/events/batch")), errs)
		}
	})

	t.Run("11b rate limit error typed when retries run out", func(t *testing.T) {
		srv.Reset()
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			if req.Path == "/v1/events/identify" {
				return testapi.JSON(w, 429, map[string]any{"error": "ingest_rate_limit_exceeded"}, map[string]string{"Retry-After": "0"})
			}
			return false
		})
		var errs []error
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.MaxRetries = 1; c.OnError = func(e error) { errs = append(errs, e) } })
		c.Identify(ctx, "u", nil)
		var rl *iforevents.RateLimitedError
		if len(srv.ByPath("/v1/events/identify")) != 2 || len(errs) != 1 || !errors.As(errs[0], &rl) {
			t.Fatalf("errs %v", errs)
		}
	})

	t.Run("12 401: no retry, dropped, AuthError surfaced", func(t *testing.T) {
		srv.Reset()
		var errs []error
		api := newAPI(t, srv, func(c *iforevents.APIConfig) {
			c.ProjectKey = "pk_wrong"
			c.BatchSize = 500
			c.OnError = func(e error) { errs = append(errs, e) }
		})
		c := iforevents.New(iforevents.WithIntegrations(api))
		c.Init(ctx)
		c.Track(ctx, "a", nil)
		c.Flush(ctx)
		var auth *iforevents.AuthError
		if len(srv.ByPath("/v1/events/batch")) != 1 || api.QueuedEvents() != 0 || len(errs) != 1 || !errors.As(errs[0], &auth) || auth.Status != 401 {
			t.Fatalf("errs %v queued %d", errs, api.QueuedEvents())
		}
	})

	t.Run("13 a failing third-party integration does not stop the api integration", func(t *testing.T) {
		srv.Reset()
		broken := &brokenIntegration{}
		api := newAPI(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1 })
		c := iforevents.New(iforevents.WithIntegrations(broken, api))
		c.Init(ctx)
		results := c.Track(ctx, "still_delivered", nil)
		if len(results) != 2 || results[0].Integration != "Broken" || results[0].Success || results[1].Integration != "IForeventsAPIIntegration" || !results[1].Success {
			t.Fatalf("results: %+v", results)
		}
		if len(srv.ByPath("/v1/events/track")) != 1 {
			t.Fatal("api integration did not receive the event")
		}
	})

	t.Run("14 no secret anywhere", func(t *testing.T) {
		srv.Reset()
		c, _ := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1 })
		c.Identify(ctx, "u", iforevents.Properties{"plan": "pro"})
		c.Track(ctx, "t", nil)
		c.Page(ctx, "/p", nil, iforevents.PageOptions{})
		for _, r := range srv.Requests() {
			for k := range r.Headers {
				if strings.Contains(strings.ToLower(k), "secret") {
					t.Fatalf("header %s", k)
				}
			}
			for k := range r.Body {
				if strings.Contains(strings.ToLower(k), "secret") {
					t.Fatalf("body key %s", k)
				}
			}
		}
	})

	t.Run("identify attributes even when the profile request fails", func(t *testing.T) {
		srv.Reset()
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			if req.Path == "/v1/events/identify" {
				return testapi.JSON(w, 500, map[string]any{"error": "down"}, nil)
			}
			return false
		})
		c, api := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 1; c.MaxRetries = -1 })
		c.Identify(ctx, "user_x", nil)
		c.Track(ctx, "still_attributed", nil)
		if api.UserID() != "user_x" || srv.ByPath("/v1/events/track")[0].Headers.Get("X-User-Id") != "user_x" {
			t.Fatalf("user id %q", api.UserID())
		}
	})

	t.Run("15 nested properties flattened with _", func(t *testing.T) {
		got := iforevents.Flatten(iforevents.Properties{"a": map[string]any{"b": map[string]any{"c": 1}}, "list": []int{1}, "plain": "x"})
		if got["a_b_c"] != 1 || got["plain"] != "x" || got["a"] != nil {
			t.Fatalf("flatten: %v", got)
		}
	})

	t.Run("queue persists across restarts with PersistQueue", func(t *testing.T) {
		srv.Reset()
		storage := iforevents.NewMemoryStorage()
		first := newAPI(t, srv, func(c *iforevents.APIConfig) {
			c.BatchSize = 100
			c.FlushInterval = 10 * time.Second
			c.Storage = storage
			c.PersistQueue = true
		})
		_ = first.Init(ctx)
		_ = first.Track(ctx, iforevents.TrackEvent{Name: "offline"})
		if v, _ := storage.Get("iforevents_queue"); !strings.Contains(v, "offline") {
			t.Fatalf("not persisted: %q", v)
		}
		second := newAPI(t, srv, func(c *iforevents.APIConfig) {
			c.BatchSize = 100
			c.FlushInterval = 10 * time.Second
			c.Storage = storage
			c.PersistQueue = true
		})
		_ = second.Init(ctx)
		if second.QueuedEvents() != 1 {
			t.Fatalf("queued %d", second.QueuedEvents())
		}
		_ = second.Flush(ctx)
		if _, ok := storage.Get("iforevents_queue"); ok || len(srv.ByPath("/v1/events/batch")) != 1 {
			t.Fatal("not drained")
		}
		_ = first.Shutdown(ctx)
	})

	t.Run("calls before Init are ignored", func(t *testing.T) {
		srv.Reset()
		c := iforevents.New(iforevents.WithIntegrations(newAPI(t, srv, nil)))
		if c.Track(ctx, "early", nil) != nil || c.Identify(ctx, "u", nil) != nil || len(srv.Requests()) != 0 {
			t.Fatal("not ignored")
		}
	})

	t.Run("ReturnErrors surfaces the typed error in results and recovers", func(t *testing.T) {
		srv.Reset()
		srv.Use(func(req testapi.Request, w http.ResponseWriter) bool {
			return testapi.JSON(w, 500, map[string]any{"error": "down"}, nil)
		})
		c, api := boot(t, srv, func(c *iforevents.APIConfig) { c.MaxRetries = -1; c.ReturnErrors = true; c.BatchSize = 500 })
		if r := c.Identify(ctx, "u", nil); r[0].Success || !strings.Contains(r[0].Err.Error(), "down") {
			t.Fatalf("results %+v", r)
		}
		c.Track(ctx, "x", nil)
		if err := api.Flush(ctx); err == nil {
			t.Fatal("expected flush error")
		}
		srv.Use(nil)
		if err := api.Flush(ctx); err != nil || len(srv.ByPath("/v1/events/batch")) == 0 {
			t.Fatalf("recover: %v", err)
		}
	})

	t.Run("concurrent tracks are all delivered", func(t *testing.T) {
		srv.Reset()
		c, api := boot(t, srv, func(c *iforevents.APIConfig) { c.BatchSize = 7; c.FlushInterval = 10 * time.Second })
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				for n := 0; n < 20; n++ {
					c.Track(ctx, "t", iforevents.Properties{"i": i, "n": n})
				}
			}(i)
		}
		wg.Wait()
		c.Flush(ctx)
		total := 0
		for _, b := range srv.ByPath("/v1/events/batch") {
			total += len(b.Body["events"].([]any))
		}
		if total != 160 || api.QueuedEvents() != 0 {
			t.Fatalf("delivered %d queued %d", total, api.QueuedEvents())
		}
	})
}

type brokenIntegration struct{ iforevents.BaseIntegration }

func (b *brokenIntegration) Name() string { return "Broken" }
func (b *brokenIntegration) Track(ctx context.Context, e iforevents.TrackEvent) error {
	_ = b.BaseIntegration.Track(ctx, e)
	return errors.New("vendor down")
}
