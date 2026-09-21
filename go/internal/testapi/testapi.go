// Package testapi is a tiny ingest api double for the SDK's own tests:
// it records requests, answers like the real api, and supports fault injection.
package testapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
)

type Request struct {
	Method  string
	Path    string
	Headers http.Header
	Body    map[string]any
}

// Scenario answers the request itself and returns true, or returns false to let the default handler answer.
type Scenario func(req Request, w http.ResponseWriter) bool

type Server struct {
	*httptest.Server
	mu       sync.Mutex
	requests []Request
	scenario Scenario
}

func New() *Server {
	s := &Server{}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	return s
}

func (s *Server) Use(sc Scenario) { s.mu.Lock(); s.scenario = sc; s.mu.Unlock() }

func (s *Server) Reset() { s.mu.Lock(); s.requests = nil; s.scenario = nil; s.mu.Unlock() }

func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Request, len(s.requests))
	copy(out, s.requests)
	return out
}

func (s *Server) ByPath(path string) []Request {
	var out []Request
	for _, r := range s.Requests() {
		if r.Path == path {
			out = append(out, r)
		}
	}
	return out
}

func JSON(w http.ResponseWriter, status int, body any, headers map[string]string) bool {
	w.Header().Set("Content-Type", "application/json")
	for k, v := range headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
	return true
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	body := map[string]any{}
	_ = json.Unmarshal(raw, &body)
	req := Request{Method: r.Method, Path: r.URL.Path, Headers: r.Header.Clone(), Body: body}
	s.mu.Lock()
	s.requests = append(s.requests, req)
	sc := s.scenario
	s.mu.Unlock()
	if sc != nil && sc(req, w) {
		return
	}
	if r.Header.Get("X-Project-Key") != "pk_test" {
		JSON(w, 401, map[string]any{"error": "invalid project key"}, nil)
		return
	}
	switch r.URL.Path {
	case "/v1/events/identify":
		JSON(w, 201, map[string]any{"user": map[string]any{"uuid": "11111111-1111-4111-8111-111111111111", "custom_id": body["custom_id"]}}, nil)
	case "/v1/events/track":
		JSON(w, 201, map[string]any{"status": "ok", "user_uuid": "22222222-2222-4222-8222-222222222222"}, nil)
	case "/v1/events/batch":
		JSON(w, 202, map[string]any{"status": "queued", "user_uuid": "33333333-3333-4333-8333-333333333333"}, nil)
	default:
		JSON(w, 404, map[string]any{"error": "not found"}, nil)
	}
}
