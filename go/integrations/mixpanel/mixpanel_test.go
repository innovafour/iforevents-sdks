package mixpanel

import (
	"context"
	"testing"

	iforevents "github.com/innovafour/iforevents-go"
	mp "github.com/mixpanel/mixpanel-go"
)

type fake struct {
	events []*mp.Event
	people []*mp.PeopleProperties
}

func (f *fake) NewEvent(name, distinctID string, props map[string]any) *mp.Event {
	props["distinct_id"] = distinctID
	return &mp.Event{Name: name, Properties: props}
}
func (f *fake) Track(_ context.Context, ev []*mp.Event) error {
	f.events = append(f.events, ev...)
	return nil
}
func (f *fake) PeopleSet(_ context.Context, p []*mp.PeopleProperties) error {
	f.people = append(f.people, p...)
	return nil
}

func TestForwarding(t *testing.T) {
	ctx := context.Background()
	f := &fake{}
	c := iforevents.New(iforevents.WithIntegrations(New(Config{Client: f})), iforevents.WithContext(func() iforevents.Properties { return nil }))
	c.Init(ctx)
	c.Track(ctx, "anon", nil)
	c.Identify(ctx, "u", iforevents.Properties{"plan": "pro", "nil": nil})
	c.Track(ctx, "paid", iforevents.Properties{"amount": 1})
	c.Page(ctx, "Home", nil, iforevents.PageOptions{NavigationType: "load"})
	c.Reset(ctx)
	c.Track(ctx, "again", nil)
	if len(f.events) != 4 || f.events[0].Properties["distinct_id"] != "server" || f.events[1].Properties["distinct_id"] != "u" || f.events[3].Properties["distinct_id"] != "server" {
		t.Fatalf("events: %+v", f.events)
	}
	if f.events[1].Properties["amount"] != 1 || f.events[1].Properties["plan"] != "pro" || f.events[1].Properties["time"] == nil {
		t.Fatalf("paid: %+v", f.events[1].Properties)
	}
	if f.events[2].Name != "Home" || f.events[2].Properties["navigation_type"] != "load" {
		t.Fatalf("page: %+v", f.events[2])
	}
	if len(f.people) != 1 || f.people[0].DistinctID != "u" || f.people[0].Properties["plan"] != "pro" || f.people[0].Properties["nil"] != nil {
		t.Fatalf("people: %+v", f.people)
	}
	if _, ok := f.people[0].Properties["nil"]; ok {
		t.Fatal("nil not dropped")
	}
}

func TestRealClientSatisfiesInterface(t *testing.T) {
	var _ Client = mp.NewApiClient("token")
	r := New(Config{Token: "token"}).Init(context.Background())
	if r != nil {
		t.Fatal(r)
	}
}
