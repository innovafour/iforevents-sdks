package segment

import (
	"context"
	"testing"

	iforevents "github.com/innovafour/iforevents-sdks/go"
	analytics "github.com/segmentio/analytics-go/v3"
)

type fake struct {
	msgs   []analytics.Message
	closed bool
}

func (f *fake) Enqueue(m analytics.Message) error { f.msgs = append(f.msgs, m); return nil }
func (f *fake) Close() error                      { f.closed = true; return nil }

func TestForwarding(t *testing.T) {
	ctx := context.Background()
	f := &fake{}
	c := iforevents.New(iforevents.WithIntegrations(New(Config{Client: f})), iforevents.WithContext(func() iforevents.Properties { return nil }))
	c.Init(ctx)
	c.Track(ctx, "anon", nil)
	c.Identify(ctx, "u", iforevents.Properties{"plan": "pro"})
	c.Track(ctx, "paid", iforevents.Properties{"amount": 1})
	c.Page(ctx, "Home", nil, iforevents.PageOptions{ToRoute: "/"})
	c.Reset(ctx)
	c.Track(ctx, "again", nil)
	c.Shutdown(ctx)
	if len(f.msgs) != 5 || !f.closed {
		t.Fatalf("msgs %d closed %v", len(f.msgs), f.closed)
	}
	if m := f.msgs[0].(analytics.Track); m.AnonymousId != "server" || m.UserId != "" {
		t.Fatalf("anon: %+v", m)
	}
	if m := f.msgs[1].(analytics.Identify); m.UserId != "u" || m.Traits["plan"] != "pro" {
		t.Fatalf("identify: %+v", m)
	}
	if m := f.msgs[2].(analytics.Track); m.UserId != "u" || m.Properties["amount"] != 1 || m.Properties["plan"] != nil || m.Timestamp.IsZero() {
		t.Fatalf("paid: %+v", m)
	}
	if m := f.msgs[3].(analytics.Page); m.Name != "Home" || m.Properties["to_route"] != "/" {
		t.Fatalf("page: %+v", m)
	}
	if m := f.msgs[4].(analytics.Track); m.AnonymousId != "server" {
		t.Fatalf("after reset: %+v", m)
	}
}

func TestRealClientCreated(t *testing.T) {
	i := New(Config{WriteKey: "wk", Configure: func(c *analytics.Config) { c.BatchSize = 1000 }})
	if err := i.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := i.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
