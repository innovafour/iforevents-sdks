package com.iforevents;

/**
 * Configuration of the first-party API integration.
 *
 * <p>Only {@link #projectKey} is required. It is a public write key: it grants
 * event ingestion and nothing else, so embedding it in an app is safe. There
 * is deliberately no project secret here.
 */
public final class APIConfig {
    public interface Callback<T> {
        void call(T value);
    }

    public final String projectKey;
    public final String baseUrl;
    public final int batchSize;
    public final long flushIntervalMillis;
    public final int timeoutMillis;
    public final int maxRetries;
    public final long retryDelayMillis;
    public final boolean requeueFailedEvents;
    public final boolean debug;
    public final boolean throwOnError;
    public final Callback<IForeventsAPIException.QuotaExceededException> onQuotaExceeded;
    public final Callback<IForeventsAPIException> onError;
    public final Storage storage;
    public final boolean persistQueue;
    public final int maxQueueSize;
    public final String userAgent;
    public final boolean flushOnShutdownHook;
    public final Hooks hooks;

    private APIConfig(Builder b) {
        this.projectKey = b.projectKey;
        this.baseUrl = b.baseUrl;
        this.batchSize = b.batchSize;
        this.flushIntervalMillis = b.flushIntervalMillis;
        this.timeoutMillis = b.timeoutMillis;
        this.maxRetries = b.maxRetries;
        this.retryDelayMillis = b.retryDelayMillis;
        this.requeueFailedEvents = b.requeueFailedEvents;
        this.debug = b.debug;
        this.throwOnError = b.throwOnError;
        this.onQuotaExceeded = b.onQuotaExceeded;
        this.onError = b.onError;
        this.storage = b.storage;
        this.persistQueue = b.persistQueue;
        this.maxQueueSize = b.maxQueueSize;
        this.userAgent = b.userAgent;
        this.flushOnShutdownHook = b.flushOnShutdownHook;
        this.hooks = b.hooks;
    }

    public static Builder builder(String projectKey) {
        return new Builder(projectKey);
    }

    public static final class Builder {
        private final String projectKey;
        private String baseUrl = "https://api.iforevents.com";
        private int batchSize = 10;
        private long flushIntervalMillis = 5000;
        private int timeoutMillis = 10000;
        private int maxRetries = 3;
        private long retryDelayMillis = 1000;
        private boolean requeueFailedEvents = true;
        private boolean debug = false;
        private boolean throwOnError = false;
        private Callback<IForeventsAPIException.QuotaExceededException> onQuotaExceeded;
        private Callback<IForeventsAPIException> onError;
        private Storage storage = new MemoryStorage();
        private boolean persistQueue = false;
        private int maxQueueSize = 1000;
        private String userAgent;
        private boolean flushOnShutdownHook = true;
        private Hooks hooks = new Hooks();

        private Builder(String projectKey) {
            if (projectKey == null || projectKey.trim().isEmpty()) throw new IllegalArgumentException("projectKey is required");
            this.projectKey = projectKey;
        }

        /** API origin; self-hosted installs pass their own host. */
        public Builder baseUrl(String v) { this.baseUrl = v; return this; }
        /** Events per request (1..500); 1 disables batching. */
        public Builder batchSize(int v) { this.batchSize = Math.max(1, Math.min(500, v)); return this; }
        /** How long a partial batch waits. */
        public Builder flushIntervalMillis(long v) { this.flushIntervalMillis = v; return this; }
        public Builder timeoutMillis(int v) { this.timeoutMillis = v; return this; }
        /** Retries for transient failures; 0 disables. */
        public Builder maxRetries(int v) { this.maxRetries = Math.max(0, v); return this; }
        public Builder retryDelayMillis(long v) { this.retryDelayMillis = v; return this; }
        public Builder requeueFailedEvents(boolean v) { this.requeueFailedEvents = v; return this; }
        public Builder debug(boolean v) { this.debug = v; return this; }
        /** Throw from identify/flush/reset instead of only reporting through {@link #onError}. */
        public Builder throwOnError(boolean v) { this.throwOnError = v; return this; }
        public Builder onQuotaExceeded(Callback<IForeventsAPIException.QuotaExceededException> v) { this.onQuotaExceeded = v; return this; }
        public Builder onError(Callback<IForeventsAPIException> v) { this.onError = v; return this; }
        public Builder storage(Storage v) { this.storage = v; return this; }
        /** Store the pending queue in storage so unsent events survive a restart. */
        public Builder persistQueue(boolean v) { this.persistQueue = v; return this; }
        public Builder maxQueueSize(int v) { this.maxQueueSize = Math.max(1, v); return this; }
        public Builder userAgent(String v) { this.userAgent = v; return this; }
        /** Register a JVM shutdown hook that flushes. Default true. */
        public Builder flushOnShutdownHook(boolean v) { this.flushOnShutdownHook = v; return this; }
        public Builder hooks(Hooks v) { this.hooks = v; return this; }

        public APIConfig build() {
            return new APIConfig(this);
        }
    }
}
