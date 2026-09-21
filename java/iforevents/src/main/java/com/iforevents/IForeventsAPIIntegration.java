package com.iforevents;

import com.iforevents.internal.Iso8601;
import com.iforevents.internal.Json;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Talks to the IForevents ingest api: identify, single or batched track, page
 * views, a client-owned user id in {@code X-User-Id}, retries with
 * {@code Retry-After} and typed errors. Thread-safe. Mirrors
 * {@code IForeventsAPIIntegration} of the Flutter package.
 */
public class IForeventsAPIIntegration extends BaseIntegration {
    private static final String USER_KEY = "iforevents_user_id";
    private static final String IDENTIFIED_KEY = "iforevents_user_identified";
    private static final String QUEUE_KEY = "iforevents_queue";
    private static final int MAX_BATCH = 500;
    private static final Logger LOG = Logger.getLogger("iforevents");
    private static final SecureRandom RANDOM = new SecureRandom();

    public final APIConfig config;
    private final String baseUrl;
    private final String userAgent;

    private final ReentrantLock lock = new ReentrantLock();
    private final ReentrantLock sendLock = new ReentrantLock();
    private final List<Map<String, Object>> queue = new ArrayList<Map<String, Object>>();
    private final ScheduledExecutorService scheduler;
    private ScheduledFuture<?> timer;
    private volatile String userId;
    private volatile boolean initialized;
    private volatile boolean identified;
    private volatile boolean quotaExceeded;

    public IForeventsAPIIntegration(APIConfig config) {
        super("IForeventsAPIIntegration", config.hooks);
        this.config = config;
        this.baseUrl = config.baseUrl.replaceAll("/+$", "");
        this.userAgent = config.userAgent != null ? config.userAgent
            : Context.SDK_NAME + "/" + Context.SDK_VERSION + " java/" + System.getProperty("java.version", "") + " (" + System.getProperty("os.name", "") + "; " + System.getProperty("os.arch", "") + ")";
        this.scheduler = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "iforevents-flush");
                t.setDaemon(true);
                return t;
            }
        });
        if (config.flushOnShutdownHook) {
            Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        shutdown();
                    } catch (Exception ignored) {
                        // nothing left to do at exit
                    }
                }
            }, "iforevents-shutdown"));
        }
    }

    // --- state -----------------------------------------------------------------

    public boolean isInitialized() { return initialized; }
    public boolean isIdentified() { return identified; }
    /** The id every request carries in {@code X-User-Id}: a generated {@code anon_...} id kept per visitor, or the customId of the last identify. */
    public String userId() { return userId; }
    /** True after a {@code quota_exceeded} answer until the next accepted request. */
    public boolean isQuotaExceeded() { return quotaExceeded; }

    public int queuedEvents() {
        lock.lock();
        try {
            return queue.size();
        } finally {
            lock.unlock();
        }
    }

    /** A fresh anonymous id, unrelated to anything the server derives: {@code anon_<uuid4 without dashes>}. */
    public static String anonymousId() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        b[6] = (byte) ((b[6] & 0x0f) | 0x40);
        b[8] = (byte) ((b[8] & 0x3f) | 0x80);
        StringBuilder sb = new StringBuilder("anon_");
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    // --- Integration ------------------------------------------------------------

    @Override
    public void init() throws Exception {
        super.init();
        lock.lock();
        try {
            String stored = config.storage.get(USER_KEY);
            if (stored != null && !stored.isEmpty()) {
                userId = stored;
                identified = "true".equals(config.storage.get(IDENTIFIED_KEY));
            } else {
                // A fresh visitor: attribute everything to an anonymous id we own, so the
                // api never has to fingerprint the address (which merges users behind a NAT).
                setUserLocked(anonymousId(), false);
            }
            if (config.persistQueue) {
                String raw = config.storage.get(QUEUE_KEY);
                if (raw != null && !raw.isEmpty()) {
                    Object decoded = null;
                    try {
                        decoded = Json.decode(raw);
                    } catch (RuntimeException ignored) {
                        // corrupt: dropped below
                    }
                    if (decoded instanceof List) {
                        for (Object item : (List<?>) decoded) {
                            if (item instanceof Map) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> m = (Map<String, Object>) item;
                                queue.add(m);
                            }
                        }
                        trimLocked();
                        scheduleLocked();
                    } else {
                        config.storage.remove(QUEUE_KEY);
                    }
                }
            }
            initialized = true;
        } finally {
            lock.unlock();
        }
        debug("api integration ready base_url=" + baseUrl + " batch_size=" + config.batchSize);
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        super.identify(event);
        Map<String, Object> properties = new LinkedHashMap<String, Object>(event.traits);
        Map<String, Object> body = new LinkedHashMap<String, Object>();
        body.put("custom_id", event.customId);
        for (String key : new String[] {"email", "name", "phone_number"}) {
            Object v = properties.get(key);
            if (v instanceof String && !((String) v).isEmpty()) {
                body.put(key, v);
                properties.remove(key);
            }
        }
        body.put("properties", properties);
        // Attribute from now on, even if the profile request itself fails: the
        // api creates the profile on the first event it sees for this id.
        setUser(event.customId, true);
        try {
            request("/v1/events/identify", body);
        } catch (IForeventsAPIException e) {
            report(e);
            if (config.throwOnError) throw e;
        }
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        super.track(event);
        Map<String, Object> queued = new LinkedHashMap<String, Object>();
        queued.put("name", event.name);
        queued.put("type", event.type);
        queued.put("properties", event.properties);
        queued.put("created_at", Iso8601.format(event.timestamp));
        if (config.batchSize <= 1) {
            Map<String, Object> body = new LinkedHashMap<String, Object>();
            body.put("event_name", event.name);
            body.put("event_type", event.type);
            body.put("properties", event.properties);
            try {
                request("/v1/events/track", body);
            } catch (IForeventsAPIException e) {
                report(e);
                if (config.throwOnError) throw e;
            }
            return;
        }
        boolean full;
        lock.lock();
        try {
            queue.add(queued);
            trimLocked();
            full = queue.size() >= config.batchSize;
            persistLocked();
            if (!full) scheduleLocked();
        } finally {
            lock.unlock();
        }
        if (full) flush();
    }

    @Override
    public void page(PageEvent event) throws Exception {
        super.page(event);
        Map<String, Object> props = new LinkedHashMap<String, Object>(event.properties);
        if (event.navigationType != null) props.put("navigation_type", event.navigationType);
        if (event.toRoute != null) props.put("to_route", event.toRoute);
        if (event.previousRoute != null) props.put("previous_route", event.previousRoute);
        track(new TrackEvent(event.name, TrackEvent.TYPE_PAGE_VIEW, props, event.timestamp));
    }

    @Override
    public void reset() throws Exception {
        super.reset();
        try {
            flush();
        } finally {
            // Forget the person; the next events belong to a fresh anonymous id.
            setUser(anonymousId(), false);
        }
    }

    /** Sends the whole queue now, 500 events per request. Blocks until done. */
    @Override
    public void flush() throws Exception {
        cancelTimer();
        sendLock.lock();
        try {
            while (true) {
                List<Map<String, Object>> events;
                lock.lock();
                try {
                    if (queue.isEmpty()) return;
                    int n = Math.min(MAX_BATCH, queue.size());
                    events = new ArrayList<Map<String, Object>>(queue.subList(0, n));
                    queue.subList(0, n).clear();
                } finally {
                    lock.unlock();
                }
                Map<String, Object> body = new LinkedHashMap<String, Object>();
                body.put("events", events);
                try {
                    request("/v1/events/batch", body);
                    lock.lock();
                    try {
                        persistLocked();
                    } finally {
                        lock.unlock();
                    }
                } catch (IForeventsAPIException e) {
                    lock.lock();
                    try {
                        if (e.isRetryable() && config.requeueFailedEvents) {
                            // Transient: keep these events at the front for the next flush.
                            queue.addAll(0, events);
                            scheduleLocked();
                        } else if (!e.isRetryable()) {
                            // A refused key or an exhausted quota fails the same way forever: drop everything.
                            queue.clear();
                        }
                        persistLocked();
                    } finally {
                        lock.unlock();
                    }
                    report(e);
                    if (config.throwOnError) throw e;
                    return;
                }
            }
        } finally {
            sendLock.unlock();
        }
    }

    @Override
    public void shutdown() throws Exception {
        try {
            flush();
        } finally {
            cancelTimer();
            scheduler.shutdownNow();
        }
    }

    // --- internals ----------------------------------------------------------------

    private void trimLocked() {
        int over = queue.size() - config.maxQueueSize;
        if (over > 0) queue.subList(0, over).clear();
    }

    private void scheduleLocked() {
        if (timer != null || queue.isEmpty() || scheduler.isShutdown()) return;
        timer = scheduler.schedule(new Runnable() {
            @Override
            public void run() {
                lock.lock();
                try {
                    timer = null;
                } finally {
                    lock.unlock();
                }
                try {
                    flush();
                } catch (Exception e) {
                    debug("timer flush failed: " + e);
                }
            }
        }, config.flushIntervalMillis, TimeUnit.MILLISECONDS);
    }

    private void cancelTimer() {
        lock.lock();
        try {
            if (timer != null) {
                timer.cancel(false);
                timer = null;
            }
        } finally {
            lock.unlock();
        }
    }

    private void persistLocked() {
        if (!config.persistQueue) return;
        if (queue.isEmpty()) config.storage.remove(QUEUE_KEY);
        else config.storage.set(QUEUE_KEY, Json.encode(queue));
    }

    private void setUser(String id, boolean isIdentified) {
        lock.lock();
        try {
            setUserLocked(id, isIdentified);
        } finally {
            lock.unlock();
        }
    }

    private void setUserLocked(String id, boolean isIdentified) {
        userId = id;
        identified = isIdentified;
        config.storage.set(USER_KEY, id);
        config.storage.set(IDENTIFIED_KEY, isIdentified ? "true" : "false");
    }

    private void report(IForeventsAPIException e) {
        debug("request failed: " + e.getMessage());
        if (config.onError != null) config.onError.call(e);
    }

    private void noteOutcome(IForeventsAPIException e) {
        if (e instanceof IForeventsAPIException.QuotaExceededException) {
            if (!quotaExceeded) {
                quotaExceeded = true;
                if (config.onQuotaExceeded != null) config.onQuotaExceeded.call((IForeventsAPIException.QuotaExceededException) e);
            }
        } else if (e == null) {
            quotaExceeded = false;
        }
    }

    private void debug(String msg) {
        if (config.debug) LOG.log(Level.INFO, "[iforevents] " + msg);
    }

    /** POSTs JSON with retries; returns the decoded body. */
    Map<String, Object> request(String path, Object body) throws IForeventsAPIException {
        byte[] payload = Json.encode(body).getBytes(StandardCharsets.UTF_8);
        String uid = userId;
        for (int attempt = 0; ; attempt++) {
            IForeventsAPIException error;
            try {
                Map<String, Object> res = once(path, payload, uid);
                noteOutcome(null);
                return res;
            } catch (IForeventsAPIException e) {
                error = e;
            }
            if (!error.isRetryable() || attempt >= config.maxRetries) {
                noteOutcome(error);
                throw error;
            }
            long delay = config.retryDelayMillis * (attempt + 1);
            if (error instanceof IForeventsAPIException.RateLimitedException && ((IForeventsAPIException.RateLimitedException) error).retryAfterMillis > 0) {
                delay = ((IForeventsAPIException.RateLimitedException) error).retryAfterMillis;
            }
            debug("retrying " + path + " in " + delay + "ms (" + (attempt + 1) + "/" + config.maxRetries + ")");
            try {
                Thread.sleep(delay);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IForeventsAPIException("interrupted", ie);
            }
        }
    }

    private Map<String, Object> once(String path, byte[] payload, String uid) throws IForeventsAPIException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(baseUrl + path).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(config.timeoutMillis);
            conn.setReadTimeout(config.timeoutMillis);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("X-Project-Key", config.projectKey);
            conn.setRequestProperty("User-Agent", userAgent);
            if (uid != null && !uid.isEmpty()) conn.setRequestProperty("X-User-Id", uid);
            OutputStream out = conn.getOutputStream();
            try {
                out.write(payload);
            } finally {
                out.close();
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : readAll(in);
            debug("POST " + path + " -> " + status);
            if (status >= 200 && status < 300) return Json.decodeObject(text);
            throw IForeventsAPIException.classify(status, Json.decodeObject(text), conn.getHeaderField("Retry-After"));
        } catch (IOException e) {
            throw new IForeventsAPIException(e.getMessage() == null ? e.toString() : e.getMessage(), e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }
}
