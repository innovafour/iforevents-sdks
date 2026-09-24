package amplitude

import (
	"context"
	"testing"

	amp "github.com/amplitude/analytics-go/amplitude"
	iforevents "github.com/innovafour/iforevents-sdks/go"
)

type fake struct {
	amp.Client
	events     []amp.Event
	identifies []amp.EventOptions
	flushed    int
	shutdowns  int
}

func (f *fake) Track(e amp.Event)                           { f.events = append(f.events, e) }
func (f *fake) Identify(_ amp.Identify, o amp.EventOptions) { f.identifies = append(f.identifies, o) }
func (f *fake) Flush()                                      { f.flushed++ }
func (f *fake) Shutdown()                                   { f.shutdowns++ }

func TestForwarding(t *testing.T) {
	ctx := context.Background()
	f := &fake{}
	c := iforevents.New(iforevents.WithIntegrations(New(Config{Client: f, DeviceID: "srv-1"})), iforevents.WithContext(func() iforevents.Properties { return nil }))
	c.Init(ctx)
	c.Track(ctx, "anon", nil)
	c.Identify(ctx, "u", iforevents.Properties{"tier": "gold"})
	c.Track(ctx, "paid", iforevents.Properties{"amount": 1})
	c.Page(ctx, "Home", nil, iforevents.PageOptions{})
	c.Flush(ctx)
	c.Shutdown(ctx)
	if len(f.events) != 3 || f.events[0].EventOptions.DeviceID != "srv-1" || f.events[0].EventOptions.UserID != "" || f.events[1].EventOptions.UserID != "u" || f.events[1].EventProperties["amount"] != 1 || f.events[1].EventProperties["tier"] != nil || f.events[1].Time == 0 {
		t.Fatalf("events: %+v", f.events)
	}
	if len(f.identifies) != 1 || f.identifies[0].UserID != "u" {
		t.Fatalf("identifies: %+v", f.identifies)
	}
	if f.events[2].EventType != "Home" || f.flushed != 1 || f.shutdowns != 1 {
		t.Fatalf("page/flush/shutdown: %+v %d %d", f.events[2], f.flushed, f.shutdowns)
	}
}

func TestRealClientCreated(t *testing.T) {
	i := New(Config{APIKey: "key", Configure: func(c *amp.Config) { c.FlushQueueSize = 1000 }})
	if err := i.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := i.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
