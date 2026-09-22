// Package posthog forwards IForevents calls to PostHog through
// github.com/posthog/posthog-go.
package posthog

import (
	"context"
	"fmt"
	"sync"

	iforevents "github.com/innovafour/iforevents-sdks/go"
	ph "github.com/posthog/posthog-go"
)

// Client is what the adapter needs; *posthog.Client satisfies it.
type Client interface {
	Enqueue(ph.Message) error
	Close() error
}

// Config of the adapter. APIKey creates a client; Client reuses one.
type Config struct {
	APIKey string
	// Endpoint of the PostHog instance. Default https://us.i.posthog.com.
	Endpoint string
	// Configure mutates the posthog.Config before the client is created.
	Configure func(*ph.Config)
	Client    Client
	// AnonymousID is the distinct id used before Identify. Default "server".
	AnonymousID string
	Hooks       iforevents.Hooks
}

type Integration struct {
	iforevents.BaseIntegration
	cfg        Config
	client     Client
	mu         sync.Mutex
	distinctID string
}

func New(cfg Config) *Integration {
	if cfg.AnonymousID == "" {
		cfg.AnonymousID = "server"
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = "https://us.i.posthog.com"
	}
	return &Integration{BaseIntegration: iforevents.BaseIntegration{IntegrationName: "PostHogIntegration", Hooks: cfg.Hooks}, cfg: cfg, client: cfg.Client}
}

func (p *Integration) Init(ctx context.Context) error {
	if err := p.BaseIntegration.Init(ctx); err != nil {
		return err
	}
	if p.client == nil {
		if p.cfg.APIKey == "" {
			return fmt.Errorf("posthog: Config.APIKey or Config.Client is required")
		}
		c := ph.Config{Endpoint: p.cfg.Endpoint}
		if p.cfg.Configure != nil {
			p.cfg.Configure(&c)
		}
		client, err := ph.NewWithConfig(p.cfg.APIKey, c)
		if err != nil {
			return err
		}
		p.client = client
	}
	return nil
}

func (p *Integration) who() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.distinctID != "" {
		return p.distinctID
	}
	return p.cfg.AnonymousID
}

func (p *Integration) Identify(ctx context.Context, e iforevents.IdentifyEvent) error {
	if err := p.BaseIntegration.Identify(ctx, e); err != nil {
		return err
	}
	p.mu.Lock()
	p.distinctID = e.CustomID
	p.mu.Unlock()
	return p.client.Enqueue(ph.Identify{DistinctId: e.CustomID, Properties: ph.Properties(e.Traits)})
}

func (p *Integration) Track(ctx context.Context, e iforevents.TrackEvent) error {
	if err := p.BaseIntegration.Track(ctx, e); err != nil {
		return err
	}
	return p.client.Enqueue(ph.Capture{DistinctId: p.who(), Event: e.Name, Properties: ph.Properties(e.Properties), Timestamp: e.Timestamp})
}

func (p *Integration) Page(ctx context.Context, e iforevents.PageEvent) error {
	if err := p.BaseIntegration.Page(ctx, e); err != nil {
		return err
	}
	props := ph.Properties{}
	for k, v := range e.Properties {
		props[k] = v
	}
	props["screen_name"], props["navigation_type"], props["to_route"], props["previous_route"] = e.Name, e.NavigationType, e.ToRoute, e.PreviousRoute
	return p.client.Enqueue(ph.Capture{DistinctId: p.who(), Event: "$pageview", Properties: props, Timestamp: e.Timestamp})
}

func (p *Integration) Reset(ctx context.Context) error {
	if err := p.BaseIntegration.Reset(ctx); err != nil {
		return err
	}
	p.mu.Lock()
	p.distinctID = ""
	p.mu.Unlock()
	return nil
}

// Shutdown closes the client, which flushes pending messages.
func (p *Integration) Shutdown(context.Context) error {
	if p.client == nil {
		return nil
	}
	return p.client.Close()
}
