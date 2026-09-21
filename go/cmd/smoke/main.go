// Command smoke ingests into a real api: IFOREVENTS_PROJECT_KEY and
// IFOREVENTS_BASE_URL must be set.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	iforevents "github.com/innovafour/iforevents-go"
)

func main() {
	key := os.Getenv("IFOREVENTS_PROJECT_KEY")
	base := os.Getenv("IFOREVENTS_BASE_URL")
	if base == "" {
		base = "https://api.iforevents.com"
	}
	if key == "" {
		fmt.Fprintln(os.Stderr, "IFOREVENTS_PROJECT_KEY missing")
		os.Exit(2)
	}
	var errs []string
	api := iforevents.MustAPIIntegration(iforevents.APIConfig{ProjectKey: key, BaseURL: base, BatchSize: 2, OnError: func(err error) { errs = append(errs, err.Error()) }})
	c := iforevents.New(iforevents.WithIntegrations(api))
	ctx := context.Background()
	c.Init(ctx)
	id := c.Identify(ctx, fmt.Sprintf("smoke_go_%d", time.Now().Unix()), iforevents.Properties{"email": "smoke@example.com", "plan": "free", "nested": map[string]any{"deep": true}})
	c.Track(ctx, "smoke_track", iforevents.Properties{"n": 1})
	c.Page(ctx, "/smoke", nil, iforevents.PageOptions{})
	c.Shutdown(ctx)
	out, _ := json.Marshal(map[string]any{"identify": id[0].Success, "user_id": api.UserID(), "queued": api.QueuedEvents(), "errors": errs})
	fmt.Println(string(out))
	if !id[0].Success || len(errs) > 0 || api.UserID() == "" {
		os.Exit(1)
	}
}
