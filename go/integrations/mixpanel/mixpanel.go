// Package mixpanel forwards IForevents calls to Mixpanel through
// github.com/mixpanel/mixpanel-go. Mirrors iforevents_mixpanel.
package mixpanel

import (
	"context"
	"fmt"
	"sync"

	iforevents "github.com/innovafour/iforevents-go"
	mp "github.com/mixpanel/mixpanel-go"
)

// Client is the slice of *mixpanel.ApiClient this adapter uses; fakes satisfy it in tests.
type Client interface {
	NewEvent(name string, distinctID string, properties map[string]any) *mp.Event
	Track(ctx context.Context, events []*mp.Event) error
	PeopleSet(ctx context.Context, people []*mp.PeopleProperties) error
}

// Config of the adapter. Token creates a client; Client reuses one.
type Config struct {
	Token string
	// Options passed to mixpanel.NewApiClient (EU residency, custom HTTP client, ...).
	Options []mp.Options
	Client  Client
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
	return &Integration{BaseIntegration: iforevents.BaseIntegration{IntegrationName: "MixpanelIntegration", Hooks: cfg.Hooks}, cfg: cfg, client: cfg.Client}
}

func (m *Integration) Init(ctx context.Context) error {
	if err := m.BaseIntegration.Init(ctx); err != nil {
		return err
	}
	if m.client == nil {
		if m.cfg.Token == "" {
			return fmt.Errorf("mixpanel: Config.Token or Config.Client is required")
		}
		m.client = mp.NewApiClient(m.cfg.Token, m.cfg.Options...)
	}
	return nil
}

func (m *Integration) who() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.distinctID != "" {
		return m.distinctID
	}
	return m.cfg.AnonymousID
}

func (m *Integration) Identify(ctx context.Context, e iforevents.IdentifyEvent) error {
	if err := m.BaseIntegration.Identify(ctx, e); err != nil {
		return err
	}
	m.mu.Lock()
	m.distinctID = e.CustomID
	m.mu.Unlock()
	return m.client.PeopleSet(ctx, []*mp.PeopleProperties{mp.NewPeopleProperties(e.CustomID, scalarize(e.Traits))})
}

func (m *Integration) Track(ctx context.Context, e iforevents.TrackEvent) error {
	if err := m.BaseIntegration.Track(ctx, e); err != nil {
		return err
	}
	ev := m.client.NewEvent(e.Name, m.who(), scalarize(e.Properties))
	if !e.Timestamp.IsZero() {
		ev.AddTime(e.Timestamp)
	}
	return m.client.Track(ctx, []*mp.Event{ev})
}

func (m *Integration) Page(ctx context.Context, e iforevents.PageEvent) error {
	if err := m.BaseIntegration.Page(ctx, e); err != nil {
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
	return m.Track(ctx, iforevents.TrackEvent{Name: name, Type: iforevents.EventTypePageView, Properties: props, Timestamp: e.Timestamp})
}

func (m *Integration) Reset(ctx context.Context) error {
	if err := m.BaseIntegration.Reset(ctx); err != nil {
		return err
	}
	m.mu.Lock()
	m.distinctID = ""
	m.mu.Unlock()
	return nil
}

// scalarize drops nils; Mixpanel accepts JSON scalars, lists and maps.
func scalarize(in iforevents.Properties) map[string]any {
	out := map[string]any{}
	for k, v := range in {
		if v == nil {
			continue
		}
		out[k] = v
	}
	return out
}
