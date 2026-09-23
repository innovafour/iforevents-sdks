package iforevents

import (
	"context"
	"log"
	"sync"
	"time"
)

// Client is the facade: one Init, then Identify, Track, Page, Reset, Flush
// and Shutdown fan out to every integration in isolation. Identify traits
// go to every integration once, on Identify, and are not copied into later
// events (each backend keeps them on the profile); nested maps are
// flattened with "_". Mirrors the Iforevents class of the Flutter package.
type Client struct {
	mu           sync.RWMutex
	integrations []Integration
	context      func() Properties
	traits       Properties
	initialized  bool
	debug        bool
	logger       *log.Logger
	onResult     func([]IntegrationResult)
}

// Option configures a Client.
type Option func(*Client)

// WithIntegrations registers integrations, in fan-out order.
func WithIntegrations(integrations ...Integration) Option {
	return func(c *Client) { c.integrations = append(c.integrations, integrations...) }
}

// WithContext replaces the context provider merged into identify traits.
func WithContext(provider func() Properties) Option {
	return func(c *Client) { c.context = provider }
}

// WithDebug logs integration failures.
func WithDebug(logger *log.Logger) Option {
	return func(c *Client) {
		c.debug = true
		if logger != nil {
			c.logger = logger
		}
	}
}

// WithResultObserver observes the outcome of every fan-out.
func WithResultObserver(fn func([]IntegrationResult)) Option {
	return func(c *Client) { c.onResult = fn }
}

// New creates a Client; call Init before use.
func New(opts ...Option) *Client {
	c := &Client{context: DefaultContext, traits: Properties{}, logger: log.Default()}
	for _, o := range opts {
		o(c)
	}
	return c
}

// PageOptions carry navigation metadata for Page.
type PageOptions struct {
	NavigationType string
	ToRoute        string
	PreviousRoute  string
}

func (c *Client) IsInitialized() bool { c.mu.RLock(); defer c.mu.RUnlock(); return c.initialized }

// CurrentTraits returns a copy of the traits remembered from the last Identify.
func (c *Client) CurrentTraits() Properties {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := Properties{}
	for k, v := range c.traits {
		out[k] = v
	}
	return out
}

// AddIntegration registers one more integration; call Init on it yourself if the client is already initialized.
func (c *Client) AddIntegration(i Integration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.integrations = append(c.integrations, i)
}

// Integration returns the registered integration with that name, or nil.
func (c *Client) Integration(name string) Integration {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, i := range c.integrations {
		if i.Name() == name {
			return i
		}
	}
	return nil
}

// Init initializes every integration. Failures are reported, never returned.
func (c *Client) Init(ctx context.Context) []IntegrationResult {
	results := c.fanOut(func(i Integration) error { return i.Init(ctx) })
	c.mu.Lock()
	c.initialized = true
	c.mu.Unlock()
	return results
}

func (c *Client) Identify(ctx context.Context, customID string, traits Properties) []IntegrationResult {
	if customID == "" || !c.ready("Identify") {
		return nil
	}
	merged := Properties{}
	for k, v := range c.safeContext() {
		merged[k] = v
	}
	for k, v := range traits {
		merged[k] = v
	}
	merged = Flatten(merged)
	results := c.fanOut(func(i Integration) error { return i.Identify(ctx, IdentifyEvent{CustomID: customID, Traits: merged}) })
	c.mu.Lock()
	c.traits = merged
	c.mu.Unlock()
	return results
}

func (c *Client) Track(ctx context.Context, name string, properties Properties) []IntegrationResult {
	if name == "" || !c.ready("Track") {
		return nil
	}
	event := TrackEvent{Name: name, Type: EventTypeTrack, Properties: Flatten(properties), Timestamp: time.Now()}
	return c.fanOut(func(i Integration) error { return i.Track(ctx, event) })
}

func (c *Client) Page(ctx context.Context, name string, properties Properties, opts PageOptions) []IntegrationResult {
	if !c.ready("Page") {
		return nil
	}
	if name == "" {
		name = "page_view"
	}
	if properties == nil {
		properties = Properties{}
	}
	event := PageEvent{Name: name, Properties: Flatten(properties), NavigationType: opts.NavigationType, ToRoute: opts.ToRoute, PreviousRoute: opts.PreviousRoute, Timestamp: time.Now()}
	return c.fanOut(func(i Integration) error { return i.Page(ctx, event) })
}

// Screen is Page with mobile naming.
func (c *Client) Screen(ctx context.Context, name string, properties Properties, opts PageOptions) []IntegrationResult {
	return c.Page(ctx, name, properties, opts)
}

// Reset forgets the user in every integration (logout).
func (c *Client) Reset(ctx context.Context) []IntegrationResult {
	if !c.ready("Reset") {
		return nil
	}
	results := c.fanOut(func(i Integration) error { return i.Reset(ctx) })
	c.mu.Lock()
	c.traits = Properties{}
	c.mu.Unlock()
	return results
}

func (c *Client) Flush(ctx context.Context) []IntegrationResult {
	return c.fanOut(func(i Integration) error { return i.Flush(ctx) })
}

// Shutdown flushes and releases every integration; the client is no longer usable.
func (c *Client) Shutdown(ctx context.Context) []IntegrationResult {
	results := c.fanOut(func(i Integration) error { return i.Shutdown(ctx) })
	c.mu.Lock()
	c.initialized = false
	c.mu.Unlock()
	return results
}

func (c *Client) ready(method string) bool {
	c.mu.RLock()
	ok := c.initialized
	c.mu.RUnlock()
	if !ok && c.debug {
		c.logger.Printf("[iforevents] %s called before Init; ignored", method)
	}
	return ok
}

func (c *Client) safeContext() (out Properties) {
	defer func() {
		if r := recover(); r != nil {
			if c.debug {
				c.logger.Printf("[iforevents] context provider panicked: %v", r)
			}
			out = Properties{}
		}
	}()
	if c.context == nil {
		return Properties{}
	}
	if p := c.context(); p != nil {
		return p
	}
	return Properties{}
}

func (c *Client) fanOut(action func(Integration) error) []IntegrationResult {
	c.mu.RLock()
	integrations := make([]Integration, len(c.integrations))
	copy(integrations, c.integrations)
	c.mu.RUnlock()
	results := make([]IntegrationResult, 0, len(integrations))
	for _, i := range integrations {
		i := i
		r := SafeExecute(i, func() error { return action(i) })
		if !r.Success && c.debug {
			c.logger.Printf("[iforevents] %s failed: %v", r.Integration, r.Err)
		}
		results = append(results, r)
	}
	if c.onResult != nil {
		c.onResult(results)
	}
	return results
}
