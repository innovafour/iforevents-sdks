package com.iforevents;

import java.util.Map;

/**
 * A request failed after retries. Every api failure body is
 * {@code {"error": <code or message>, "message"?: ...}}. {@link AuthException}
 * and {@link QuotaExceededException} are permanent: their events are dropped.
 */
public class IForeventsAPIException extends Exception {
    private static final long serialVersionUID = 1L;

    public final int status;
    public final String code;
    public final Map<String, Object> details;

    public IForeventsAPIException(String message, int status, String code, Map<String, Object> details, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public IForeventsAPIException(String message, Throwable cause) {
        this(message, 0, null, null, cause);
    }

    /** Transient failures (network, 5xx) are retried and their events kept. */
    public boolean isRetryable() {
        return status == 0 || status >= 500;
    }

    /** Project key unknown, rotated or project disabled (401/403). */
    public static class AuthException extends IForeventsAPIException {
        private static final long serialVersionUID = 1L;

        public AuthException(String message, int status, String code, Map<String, Object> details) {
            super(message, status, code, details, null);
        }

        @Override
        public boolean isRetryable() {
            return false;
        }
    }

    /** Monthly plan quota exhausted (429 {@code quota_exceeded}). */
    public static class QuotaExceededException extends IForeventsAPIException {
        private static final long serialVersionUID = 1L;

        public final long limit;
        public final long used;
        public final String organizationUuid;

        public QuotaExceededException(String message, Map<String, Object> details, long limit, long used, String organizationUuid) {
            super(message, 429, "quota_exceeded", details, null);
            this.limit = limit;
            this.used = used;
            this.organizationUuid = organizationUuid;
        }

        @Override
        public boolean isRetryable() {
            return false;
        }
    }

    /** Too many requests in a short window (429 without a quota code); retried after {@link #retryAfterMillis}. */
    public static class RateLimitedException extends IForeventsAPIException {
        private static final long serialVersionUID = 1L;

        public final long retryAfterMillis;

        public RateLimitedException(String message, String code, Map<String, Object> details, long retryAfterMillis) {
            super(message, 429, code, details, null);
            this.retryAfterMillis = retryAfterMillis;
        }

        @Override
        public boolean isRetryable() {
            return true;
        }
    }

    static IForeventsAPIException classify(int status, Map<String, Object> details, String retryAfterHeader) {
        String code = details.get("error") instanceof String ? (String) details.get("error") : null;
        Object msg = details.get("message");
        String message = msg != null ? msg.toString() : code != null ? code : "request failed with status " + status;
        if (status == 429 && "quota_exceeded".equals(code)) {
            Object org = details.get("org_uuid");
            return new QuotaExceededException(message, details, asLong(details.get("limit")), asLong(details.get("used")), org == null ? null : org.toString());
        }
        if (status == 429) {
            long wait = 0;
            if (retryAfterHeader != null) {
                try {
                    wait = Long.parseLong(retryAfterHeader.trim()) * 1000L;
                } catch (NumberFormatException ignored) {
                    // fall through to the body
                }
            }
            if (wait <= 0) wait = asLong(details.get("retry_after_seconds")) * 1000L;
            return new RateLimitedException(message, code, details, wait);
        }
        if (status == 401 || status == 403) return new AuthException(message, status, code, details);
        return new IForeventsAPIException(message, status, code, details, null);
    }

    private static long asLong(Object v) {
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try {
                return Long.parseLong((String) v);
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }
        return 0;
    }
}
