// Package segment forwards IForevents calls to Segment through
// github.com/segmentio/analytics-go/v3. Mirrors iforevents_segment.
package segment

import (
	"context"
	"fmt"
	"sync"

	iforevents "github.com/innovafour/iforevents-go"
	analytics "github.com/segmentio/analytics-go/v3"
)

// Config of the adapter. WriteKey creates a client; Client reuses one.
type Config struct {
	WriteKey string
	// Configure mutates the analytics.Config before the client is created (endpoint, batch size, logger).
	Configure func(*analytics.Config)
	Client    analytics.Client
	// AnonymousID is used for events before Identify. Default "server".
	AnonymousID string
	Hooks       iforevents.Hooks
}

type Integration struct {
	iforevents.BaseIntegration
	cfg    Config
	client analytics.Client
	mu     sync.Mutex
	userID string
}

func New(cfg Config) *Integration {
	if cfg.AnonymousID == "" {
		cfg.AnonymousID = "server"
	}
	return &Integration{BaseIntegration: iforevents.BaseIntegration{IntegrationName: "SegmentIntegration", Hooks: cfg.Hooks}, cfg: cfg, client: cfg.Client}
}

func (s *Integration) Init(ctx context.Context) error {
	if err := s.BaseIntegration.Init(ctx); err != nil {
		return err
	}
	if s.client == nil {
		if s.cfg.WriteKey == "" {
			return fmt.Errorf("segment: Config.WriteKey or Config.Client is required")
		}
		c := analytics.Config{}
		if s.cfg.Configure != nil {
			s.cfg.Configure(&c)
		}
		client, err := analytics.NewWithConfig(s.cfg.WriteKey, c)
		if err != nil {
			return err
		}
		s.client = client
	}
	return nil
}

func (s *Integration) who() (userID, anonymousID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.userID != "" {
		return s.userID, ""
	}
	return "", s.cfg.AnonymousID
}

func (s *Integration) Identify(ctx context.Context, e iforevents.IdentifyEvent) error {
	if err := s.BaseIntegration.Identify(ctx, e); err != nil {
		return err
	}
	s.mu.Lock()
	s.userID = e.CustomID
	s.mu.Unlock()
	return s.client.Enqueue(analytics.Identify{UserId: e.CustomID, Traits: analytics.Traits(e.Traits)})
}

func (s *Integration) Track(ctx context.Context, e iforevents.TrackEvent) error {
	if err := s.BaseIntegration.Track(ctx, e); err != nil {
		return err
	}
	u, a := s.who()
	return s.client.Enqueue(analytics.Track{UserId: u, AnonymousId: a, Event: e.Name, Properties: analytics.Properties(e.Properties), Timestamp: e.Timestamp})
}

func (s *Integration) Page(ctx context.Context, e iforevents.PageEvent) error {
	if err := s.BaseIntegration.Page(ctx, e); err != nil {
		return err
	}
	props := analytics.Properties{}
	for k, v := range e.Properties {
		props[k] = v
	}
	props["navigation_type"], props["to_route"], props["previous_route"] = e.NavigationType, e.ToRoute, e.PreviousRoute
	u, a := s.who()
	return s.client.Enqueue(analytics.Page{UserId: u, AnonymousId: a, Name: e.Name, Properties: props, Timestamp: e.Timestamp})
}

func (s *Integration) Reset(ctx context.Context) error {
	if err := s.BaseIntegration.Reset(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	s.userID = ""
	s.mu.Unlock()
	return nil
}

// Shutdown closes the client, which flushes the queue.
func (s *Integration) Shutdown(context.Context) error {
	if s.client == nil {
		return nil
	}
	return s.client.Close()
}
