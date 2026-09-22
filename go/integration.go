package iforevents

import (
	"context"
	"fmt"
	"time"
)

// Integration is implemented by every destination. Embed BaseIntegration to
// get no-op defaults and hooks, then override what the vendor supports.
type Integration interface {
	Name() string
	Init(ctx context.Context) error
	Identify(ctx context.Context, event IdentifyEvent) error
	Track(ctx context.Context, event TrackEvent) error
	Page(ctx context.Context, event PageEvent) error
	Reset(ctx context.Context) error
	Flush(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

// Hooks are optional callbacks fired before an integration handles a call.
type Hooks struct {
	OnInit     func()
	OnIdentify func(IdentifyEvent)
	OnTrack    func(TrackEvent)
	OnPage     func(PageEvent)
	OnReset    func()
}

// BaseIntegration provides the defaults; mirrors the Flutter Integration base.
type BaseIntegration struct {
	IntegrationName string
	Hooks           Hooks
}

func (b *BaseIntegration) Name() string {
	if b.IntegrationName == "" {
		return "Integration"
	}
	return b.IntegrationName
}

func (b *BaseIntegration) Init(context.Context) error {
	if b.Hooks.OnInit != nil {
		b.Hooks.OnInit()
	}
	return nil
}

func (b *BaseIntegration) Identify(_ context.Context, e IdentifyEvent) error {
	if b.Hooks.OnIdentify != nil {
		b.Hooks.OnIdentify(e)
	}
	return nil
}

func (b *BaseIntegration) Track(_ context.Context, e TrackEvent) error {
	if b.Hooks.OnTrack != nil {
		b.Hooks.OnTrack(e)
	}
	return nil
}

func (b *BaseIntegration) Page(_ context.Context, e PageEvent) error {
	if b.Hooks.OnPage != nil {
		b.Hooks.OnPage(e)
	}
	return nil
}

func (b *BaseIntegration) Reset(context.Context) error {
	if b.Hooks.OnReset != nil {
		b.Hooks.OnReset()
	}
	return nil
}

func (b *BaseIntegration) Flush(context.Context) error    { return nil }
func (b *BaseIntegration) Shutdown(context.Context) error { return nil }

// SafeExecute runs one integration call in isolation (panics included) and
// reports the outcome.
func SafeExecute(integration Integration, action func() error) (result IntegrationResult) {
	result = IntegrationResult{Integration: integration.Name(), Timestamp: time.Now()}
	defer func() {
		if r := recover(); r != nil {
			result.Success = false
			result.Err = fmt.Errorf("panic: %v", r)
		}
	}()
	if err := action(); err != nil {
		result.Err = err
		return result
	}
	result.Success = true
	return result
}
