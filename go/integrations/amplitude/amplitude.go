// Package amplitude forwards IForevents calls to Amplitude through
// github.com/amplitude/analytics-go. Mirrors iforevents_amplitude.
package amplitude

import (
	"context"
	"fmt"
	"sync"

	amp "github.com/amplitude/analytics-go/amplitude"
	iforevents "github.com/innovafour/iforevents-sdks/go"
)

// Config of the adapter. APIKey creates a client; Client reuses one.
type Config struct {
	APIKey string
	// Configure mutates the amplitude.Config before the client is created (server zone, flush sizes, logger).
	Configure func(*amp.Config)
	Client    amp.Client
	// DeviceID is used for events before Identify. Default "server".
	DeviceID string
	Hooks    iforevents.Hooks
}

type Integration struct {
	iforevents.BaseIntegration
	cfg    Config
	client amp.Client
	mu     sync.Mutex
	userID string
}

func New(cfg Config) *Integration {
	if cfg.DeviceID == "" {
		cfg.DeviceID = "server"
	}
	return &Integration{BaseIntegration: iforevents.BaseIntegration{IntegrationName: "AmplitudeIntegration", Hooks: cfg.Hooks}, cfg: cfg, client: cfg.Client}
}

func (a *Integration) Init(ctx context.Context) error {
	if err := a.BaseIntegration.Init(ctx); err != nil {
		return err
	}
	if a.client == nil {
		if a.cfg.APIKey == "" {
			return fmt.Errorf("amplitude: Config.APIKey or Config.Client is required")
		}
		c := amp.NewConfig(a.cfg.APIKey)
		if a.cfg.Configure != nil {
			a.cfg.Configure(&c)
		}
		a.client = amp.NewClient(c)
	}
	return nil
}

func (a *Integration) options(t int64) amp.EventOptions {
	a.mu.Lock()
	defer a.mu.Unlock()
	opts := amp.EventOptions{Time: t}
	if a.userID != "" {
		opts.UserID = a.userID
	} else {
		opts.DeviceID = a.cfg.DeviceID
	}
	return opts
}

func (a *Integration) Identify(ctx context.Context, e iforevents.IdentifyEvent) error {
	if err := a.BaseIntegration.Identify(ctx, e); err != nil {
		return err
	}
	a.mu.Lock()
	a.userID = e.CustomID
	a.mu.Unlock()
	id := amp.Identify{}
	for k, v := range e.Traits {
		if v != nil {
			id.Set(k, v)
		}
	}
	a.client.Identify(id, amp.EventOptions{UserID: e.CustomID})
	return nil
}

func (a *Integration) Track(ctx context.Context, e iforevents.TrackEvent) error {
	if err := a.BaseIntegration.Track(ctx, e); err != nil {
		return err
	}
	props := map[string]interface{}{}
	for k, v := range e.Properties {
		if v != nil {
			props[k] = v
		}
	}
	var t int64
	if !e.Timestamp.IsZero() {
		t = e.Timestamp.UnixMilli()
	}
	a.client.Track(amp.Event{EventType: e.Name, EventOptions: a.options(t), EventProperties: props})
	return nil
}

func (a *Integration) Page(ctx context.Context, e iforevents.PageEvent) error {
	if err := a.BaseIntegration.Page(ctx, e); err != nil {
		return err
	}
	props := iforevents.Properties{}
	for k, v := range e.Properties {
		props[k] = v
	}
	props["navigation_type"], props["to_route"], props["previous_route"] = e.NavigationType, e.ToRoute, e.PreviousRoute
	name := e.Name
	if name == "" {
		name = "page_view"
	}
	return a.Track(ctx, iforevents.TrackEvent{Name: name, Type: iforevents.EventTypePageView, Properties: props, Timestamp: e.Timestamp})
}

func (a *Integration) Reset(ctx context.Context) error {
	if err := a.BaseIntegration.Reset(ctx); err != nil {
		return err
	}
	a.mu.Lock()
	a.userID = ""
	a.mu.Unlock()
	return nil
}

func (a *Integration) Flush(context.Context) error {
	if a.client != nil {
		a.client.Flush()
	}
	return nil
}

func (a *Integration) Shutdown(context.Context) error {
	if a.client != nil {
		a.client.Shutdown()
	}
	return nil
}
