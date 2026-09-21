package posthog

import (
	"context"
	"testing"

	iforevents "github.com/innovafour/iforevents-go"
	ph "github.com/posthog/posthog-go"
)

type fake struct {
	msgs   []ph.Message
	closed bool
}

func (f *fake) Enqueue(m ph.Message) error { f.msgs = append(f.msgs, m); return nil }
func (f *fake) Close() error               { f.closed = true; return nil }

func TestForwarding(t *testing.T) {
	ctx := context.Background()
	f := &fake{}
	c := iforevents.New(iforevents.WithIntegrations(New(Config{Client: f})), iforevents.WithContext(func() iforevents.Properties { return nil }))
	c.Init(ctx)
	c.Track(ctx, "anon", nil)
	c.Identify(ctx, "u", iforevents.Properties{"plan": "pro"})
	c.Track(ctx, "paid", nil)
	c.Page(ctx, "Home", nil, iforevents.PageOptions{})
	c.Shutdown(ctx)
	if len(f.msgs) != 4 || !f.closed {
		t.Fatalf("msgs %d closed %v", len(f.msgs), f.closed)
	}
	if m := f.msgs[0].(ph.Capture); m.DistinctId != "server" {
		t.Fatalf("anon: %+v", m)
	}
	if m := f.msgs[1].(ph.Identify); m.DistinctId != "u" || m.Properties["plan"] != "pro" {
		t.Fatalf("identify: %+v", m)
	}
	if m := f.msgs[2].(ph.Capture); m.DistinctId != "u" || m.Event != "paid" {
		t.Fatalf("paid: %+v", m)
	}
	if m := f.msgs[3].(ph.Capture); m.Event != "$pageview" || m.Properties["screen_name"] != "Home" {
		t.Fatalf("page: %+v", m)
	}
}

func TestRealClientCreated(t *testing.T) {
	var _ Client = ph.New("k")
	i := New(Config{APIKey: "k", Configure: func(c *ph.Config) { c.BatchSize = 1000 }})
	if err := i.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := i.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
