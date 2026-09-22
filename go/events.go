// Package iforevents is the IForevents analytics SDK for Go: one facade,
// pluggable integrations, and a first-party API integration with batching,
// retries and typed errors. Only the public project key is ever configured;
// it grants event ingestion and nothing else.
package iforevents

import "time"

// Properties are free-form event or trait properties. Nested maps are
// flattened with "_" before reaching integrations.
type Properties map[string]any

// Event types the api distinguishes.
const (
	EventTypeTrack    = "track"
	EventTypePageView = "page_view"
)

// IdentifyEvent is the app's own user id plus traits (context merged in,
// nested maps flattened).
type IdentifyEvent struct {
	CustomID string
	Traits   Properties
}

// TrackEvent is a tracked event ready for every integration.
type TrackEvent struct {
	Name       string
	Type       string
	Properties Properties
	// Timestamp is when the event was queued; sent as created_at.
	Timestamp time.Time
}

// PageEvent is a page (web) or screen (mobile) view.
type PageEvent struct {
	Name           string
	Properties     Properties
	NavigationType string
	ToRoute        string
	PreviousRoute  string
	Timestamp      time.Time
}

// IntegrationResult is the outcome of one integration call; the facade never
// returns an error for these.
type IntegrationResult struct {
	Integration string
	Success     bool
	Err         error
	Timestamp   time.Time
}

// Flatten flattens nested maps with "_": {"a": {"b": 1}} becomes {"a_b": 1}.
// Slices and other values are kept as they are.
func Flatten(in Properties) Properties {
	out := Properties{}
	flattenInto(out, "", in)
	return out
}

func flattenInto(out Properties, prefix string, in map[string]any) {
	for k, v := range in {
		name := k
		if prefix != "" {
			name = prefix + "_" + k
		}
		switch nested := v.(type) {
		case Properties:
			flattenInto(out, name, nested)
		case map[string]any:
			flattenInto(out, name, nested)
		default:
			out[name] = v
		}
	}
}
