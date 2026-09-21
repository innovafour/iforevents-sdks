package iforevents

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// APIError is a request that failed after retries. Every api failure body is
// {"error": <code or message>, "message"?: ...}. Use errors.As to detect the
// typed variants below.
type APIError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
	Cause   error
}

func (e *APIError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("iforevents: %s (status %d)", e.Message, e.Status)
	}
	return "iforevents: " + e.Message
}

func (e *APIError) Unwrap() error { return e.Cause }

// Retryable reports whether the failure is transient (network, 5xx).
func (e *APIError) Retryable() bool { return e.Status == 0 || e.Status >= 500 }

// AuthError: project key unknown, rotated, or project disabled (401/403). Permanent.
type AuthError struct{ APIError }

func (e *AuthError) Retryable() bool { return false }

// QuotaExceededError: the monthly plan quota is exhausted (429 quota_exceeded). Permanent until the next month or a plan change.
type QuotaExceededError struct {
	APIError
	Limit            int64
	Used             int64
	OrganizationUUID string
}

func (e *QuotaExceededError) Retryable() bool { return false }

// RateLimitedError: too many requests in a short window (429 without a quota code); retried after RetryAfter.
type RateLimitedError struct {
	APIError
	RetryAfter time.Duration
}

func (e *RateLimitedError) Retryable() bool { return true }

// retryable is satisfied by every error type above.
type retryable interface {
	error
	Retryable() bool
}

func classifyResponse(status int, body []byte, retryAfterHeader string) retryable {
	var details map[string]any
	_ = json.Unmarshal(body, &details)
	code, _ := details["error"].(string)
	message := code
	if m, ok := details["message"].(string); ok && m != "" {
		message = m
	}
	if message == "" {
		message = fmt.Sprintf("request failed with status %d", status)
	}
	base := APIError{Status: status, Code: code, Message: message, Details: details}
	switch {
	case status == 429 && code == "quota_exceeded":
		org, _ := details["org_uuid"].(string)
		return &QuotaExceededError{APIError: base, Limit: asInt(details["limit"]), Used: asInt(details["used"]), OrganizationUUID: org}
	case status == 429:
		var wait time.Duration
		if s, err := strconv.Atoi(retryAfterHeader); err == nil && s > 0 {
			wait = time.Duration(s) * time.Second
		} else if n := asInt(details["retry_after_seconds"]); n > 0 {
			wait = time.Duration(n) * time.Second
		}
		return &RateLimitedError{APIError: base, RetryAfter: wait}
	case status == 401 || status == 403:
		return &AuthError{APIError: base}
	default:
		return &base
	}
}

func asInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}
