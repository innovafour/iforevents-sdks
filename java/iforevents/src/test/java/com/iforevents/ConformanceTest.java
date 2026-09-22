package com.iforevents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Conformance suite for sdks/CONTRACT.md section 8; each test names its item. */
class ConformanceTest {
    private static MockApi api;
    private static final Pattern ANON = Pattern.compile("^anon_[0-9a-f]{32}$");
    private final List<IForeventsAPIIntegration> active = new ArrayList<IForeventsAPIIntegration>();

    @BeforeAll
    static void start() throws IOException {
        api = new MockApi();
    }

    @AfterAll
    static void stop() {
        api.stop();
    }

    @BeforeEach
    void reset() {
        api.reset();
    }

    @AfterEach
    void cleanup() throws Exception {
        for (IForeventsAPIIntegration i : active) i.shutdown();
        active.clear();
    }

    private APIConfig.Builder cfg() {
        return APIConfig.builder("pk_test").baseUrl(api.baseUrl).retryDelayMillis(10).flushIntervalMillis(60).flushOnShutdownHook(false);
    }

    private IForeventsAPIIntegration make(APIConfig.Builder b) {
        IForeventsAPIIntegration i = new IForeventsAPIIntegration(b.build());
        active.add(i);
        return i;
    }

    private Iforevents boot(IForeventsAPIIntegration api, Integration... extra) {
        Iforevents.Builder b = Iforevents.builder().integration(api).context(new Iforevents.ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return map("device_platform", "test", "sdk_name", "iforevents-java");
            }
        });
        for (Integration e : extra) b.integration(e);
        Iforevents ife = b.build();
        ife.init();
        return ife;
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @SuppressWarnings("unchecked")
    private static List<String> names(MockApi.Recorded r) {
        List<String> out = new ArrayList<String>();
        for (Object e : (List<Object>) r.body.get("events")) out.add((String) ((Map<String, Object>) e).get("name"));
        return out;
    }

    @Test
    void t01_identify_lifts_fields_switches_user_id() {
        IForeventsAPIIntegration integration = make(cfg());
        Iforevents ife = boot(integration);
        ife.identify("user_1", map("email", "ada@example.com", "name", "Ada", "phone_number", "+1", "plan", "pro", "nested", map("a", 1)));
        MockApi.Recorded req = api.byPath("/v1/events/identify").get(0);
        assertEquals("pk_test", req.header("X-Project-Key"));
        assertEquals("application/json", req.header("Content-Type"));
        assertTrue(req.header("User-Agent").startsWith("iforevents-java/"));
        assertEquals("user_1", req.header("X-User-Id"));
        assertEquals("user_1", req.body.get("custom_id"));
        assertEquals("ada@example.com", req.body.get("email"));
        assertEquals("Ada", req.body.get("name"));
        assertEquals("+1", req.body.get("phone_number"));
        assertEquals(map("plan", "pro", "nested_a", 1L, "device_platform", "test", "sdk_name", "iforevents-java"), req.body.get("properties"));
        assertEquals("user_1", integration.userId());
        assertTrue(integration.isIdentified());
    }

    @Test
    void t02_track_after_identify_carries_user_id_and_traits() {
        Iforevents ife = boot(make(cfg().batchSize(1)));
        ife.identify("user_1", map("plan", "pro"));
        ife.track("clicked", map("button", "buy", "plan", "override"));
        MockApi.Recorded req = api.byPath("/v1/events/track").get(0);
        assertEquals("user_1", req.header("X-User-Id"));
        assertEquals("clicked", req.body.get("event_name"));
        assertEquals("track", req.body.get("event_type"));
        assertEquals(map("plan", "override", "button", "buy", "device_platform", "test", "sdk_name", "iforevents-java"), req.body.get("properties"));
    }

    @Test
    void t03_batch_size_n_sends_on_nth() throws Exception {
        Iforevents ife = boot(make(cfg().batchSize(3).flushIntervalMillis(10000)));
        ife.track("a");
        ife.track("b");
        Thread.sleep(20);
        assertEquals(0, api.requests.size());
        ife.track("c");
        List<MockApi.Recorded> batches = api.byPath("/v1/events/batch");
        assertEquals(1, batches.size());
        assertEquals(Arrays.asList("a", "b", "c"), names(batches.get(0)));
        @SuppressWarnings("unchecked")
        Map<String, Object> first = (Map<String, Object>) ((List<Object>) batches.get(0).body.get("events")).get(0);
        assertEquals("track", first.get("type"));
        assertTrue(((String) first.get("created_at")).endsWith("Z"));
    }

    @Test
    void t04_flush_interval_sends_partial_queue() throws Exception {
        Iforevents ife = boot(make(cfg().batchSize(50).flushIntervalMillis(50)));
        ife.track("only");
        assertEquals(0, api.requests.size());
        long deadline = System.currentTimeMillis() + 3000;
        while (api.byPath("/v1/events/batch").isEmpty() && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        assertEquals(1, api.byPath("/v1/events/batch").size());
    }

    @Test
    void t05_batch_size_1_posts_track() {
        Iforevents ife = boot(make(cfg().batchSize(1)));
        ife.track("solo", map("n", 1));
        MockApi.Recorded req = api.byPath("/v1/events/track").get(0);
        assertEquals("solo", req.body.get("event_name"));
        assertEquals("track", req.body.get("event_type"));
    }

    @Test
    void t06_page_view_type_and_navigation() {
        Iforevents ife = boot(make(cfg().batchSize(1)));
        ife.page("/pricing", map("title", "Pricing"), "push", null, "/");
        MockApi.Recorded req = api.byPath("/v1/events/track").get(0);
        assertEquals("/pricing", req.body.get("event_name"));
        assertEquals("page_view", req.body.get("event_type"));
        assertEquals(map("title", "Pricing", "navigation_type", "push", "previous_route", "/"), req.body.get("properties"));
    }

    @Test
    void t07_anonymous_id_generated_persisted_reused() throws Exception {
        MemoryStorage storage = new MemoryStorage();
        IForeventsAPIIntegration integration = make(cfg().batchSize(1).storage(storage));
        Iforevents ife = boot(integration);
        ife.track("first");
        ife.track("second");
        List<MockApi.Recorded> reqs = api.byPath("/v1/events/track");
        String anon = reqs.get(0).header("X-User-Id");
        assertTrue(ANON.matcher(anon).matches(), anon);
        assertEquals(anon, reqs.get(1).header("X-User-Id"));
        assertEquals(anon, integration.userId());
        assertFalse(integration.isIdentified());
        assertEquals(anon, storage.get("iforevents_user_id"));
        assertEquals("false", storage.get("iforevents_user_identified"));
        IForeventsAPIIntegration again = make(cfg().storage(storage));
        again.init();
        assertEquals(anon, again.userId());
        IForeventsAPIIntegration other = make(cfg());
        other.init();
        assertTrue(ANON.matcher(other.userId()).matches());
        assertNotEquals(anon, other.userId());
    }

    @Test
    void t08_reset_flushes_then_fresh_anonymous_id() {
        MemoryStorage storage = new MemoryStorage();
        IForeventsAPIIntegration integration = make(cfg().batchSize(10).flushIntervalMillis(10000).storage(storage));
        Iforevents ife = boot(integration);
        ife.identify("user_1", null);
        ife.track("before_logout");
        ife.reset();
        List<MockApi.Recorded> batches = api.byPath("/v1/events/batch");
        assertEquals(1, batches.size());
        assertEquals("user_1", batches.get(0).header("X-User-Id"));
        assertTrue(ANON.matcher(integration.userId()).matches());
        assertFalse(integration.isIdentified());
        assertEquals(integration.userId(), storage.get("iforevents_user_id"));
        assertEquals("false", storage.get("iforevents_user_identified"));
        assertTrue(ife.currentTraits().isEmpty());
        ife.track("after_logout");
        ife.flush();
        String after = api.byPath("/v1/events/batch").get(1).header("X-User-Id");
        assertEquals(integration.userId(), after);
        assertNotEquals("user_1", after);
    }

    @Test
    void t09_500_then_200_retries_same_events_once() {
        final int[] failures = {0};
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                if (req.path.equals("/v1/events/batch") && failures[0] < 1) {
                    failures[0]++;
                    return MockApi.send(ex, 500, "{\"error\":\"boom\"}", null);
                }
                return false;
            }
        };
        Iforevents ife = boot(make(cfg().batchSize(2).maxRetries(2)));
        ife.track("x");
        ife.track("y");
        ife.flush();
        List<MockApi.Recorded> batches = api.byPath("/v1/events/batch");
        assertEquals(2, batches.size());
        assertEquals(Arrays.asList("x", "y"), names(batches.get(1)));
    }

    @Test
    void t10_quota_exceeded_no_retry_drop_callback_once() {
        final boolean[] refuse = {true};
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                if (req.path.equals("/v1/events/batch") && refuse[0]) {
                    return MockApi.send(ex, 429, "{\"error\":\"quota_exceeded\",\"message\":\"plan quota exhausted\",\"limit\":5000000,\"used\":5000001,\"org_uuid\":\"org-1\"}", null);
                }
                return false;
            }
        };
        final List<IForeventsAPIException.QuotaExceededException> seen = new ArrayList<IForeventsAPIException.QuotaExceededException>();
        IForeventsAPIIntegration integration = make(cfg().batchSize(500).onQuotaExceeded(new APIConfig.Callback<IForeventsAPIException.QuotaExceededException>() {
            @Override
            public void call(IForeventsAPIException.QuotaExceededException e) {
                seen.add(e);
            }
        }));
        Iforevents ife = boot(integration);
        ife.track("a");
        ife.flush();
        ife.track("b");
        ife.flush();
        assertEquals(2, api.byPath("/v1/events/batch").size());
        assertEquals(1, seen.size());
        assertEquals(5000000L, seen.get(0).limit);
        assertEquals(5000001L, seen.get(0).used);
        assertEquals("org-1", seen.get(0).organizationUuid);
        assertTrue(integration.isQuotaExceeded());
        assertEquals(0, integration.queuedEvents());
        refuse[0] = false;
        ife.track("c");
        ife.flush();
        assertFalse(integration.isQuotaExceeded());
        List<MockApi.Recorded> batches = api.byPath("/v1/events/batch");
        assertEquals(Collections.singletonList("c"), names(batches.get(batches.size() - 1)));
    }

    @Test
    void t11_rate_limit_retry_after_honored() {
        final boolean[] limited = {true};
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                if (req.path.equals("/v1/events/batch") && limited[0]) {
                    limited[0] = false;
                    return MockApi.send(ex, 429, "{\"error\":\"ingest_rate_limit_exceeded\",\"retry_after_seconds\":1}", Collections.singletonMap("Retry-After", "1"));
                }
                return false;
            }
        };
        final List<IForeventsAPIException> errors = new ArrayList<IForeventsAPIException>();
        Iforevents ife = boot(make(cfg().batchSize(500).onError(new APIConfig.Callback<IForeventsAPIException>() {
            @Override
            public void call(IForeventsAPIException e) {
                errors.add(e);
            }
        })));
        ife.track("r");
        long started = System.currentTimeMillis();
        ife.flush();
        assertTrue(System.currentTimeMillis() - started >= 950);
        assertEquals(2, api.byPath("/v1/events/batch").size());
        assertTrue(errors.isEmpty());
    }

    @Test
    void t11b_rate_limit_error_typed_when_retries_exhausted() {
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                return req.path.equals("/v1/events/identify") && MockApi.send(ex, 429, "{\"error\":\"ingest_rate_limit_exceeded\"}", Collections.singletonMap("Retry-After", "0"));
            }
        };
        final List<IForeventsAPIException> errors = new ArrayList<IForeventsAPIException>();
        Iforevents ife = boot(make(cfg().maxRetries(1).onError(new APIConfig.Callback<IForeventsAPIException>() {
            @Override
            public void call(IForeventsAPIException e) {
                errors.add(e);
            }
        })));
        ife.identify("u", null);
        assertEquals(2, api.byPath("/v1/events/identify").size());
        assertTrue(errors.get(0) instanceof IForeventsAPIException.RateLimitedException);
    }

    @Test
    void t12_401_no_retry_drop_auth_error() {
        final List<IForeventsAPIException> errors = new ArrayList<IForeventsAPIException>();
        IForeventsAPIIntegration integration = make(APIConfig.builder("pk_wrong").baseUrl(api.baseUrl).batchSize(500).retryDelayMillis(10).flushOnShutdownHook(false).onError(new APIConfig.Callback<IForeventsAPIException>() {
            @Override
            public void call(IForeventsAPIException e) {
                errors.add(e);
            }
        }));
        Iforevents ife = Iforevents.builder().integration(integration).build();
        ife.init();
        ife.track("a");
        ife.flush();
        assertEquals(1, api.byPath("/v1/events/batch").size());
        assertEquals(0, integration.queuedEvents());
        assertTrue(errors.get(0) instanceof IForeventsAPIException.AuthException);
        assertEquals(401, errors.get(0).status);
    }

    @Test
    void t13_throwing_integration_does_not_stop_api() {
        Integration broken = new BaseIntegration("Broken", null) {
            @Override
            public void track(TrackEvent event) throws Exception {
                super.track(event);
                throw new RuntimeException("vendor down");
            }
        };
        IForeventsAPIIntegration integration = make(cfg().batchSize(1));
        Iforevents ife = Iforevents.builder().integration(broken).integration(integration).build();
        ife.init();
        List<IntegrationResult> results = ife.track("still_delivered");
        assertEquals("Broken", results.get(0).integration);
        assertFalse(results.get(0).success);
        assertEquals("IForeventsAPIIntegration", results.get(1).integration);
        assertTrue(results.get(1).success);
        assertEquals(1, api.byPath("/v1/events/track").size());
    }

    @Test
    void t14_no_secret_anywhere() {
        Iforevents ife = boot(make(cfg().batchSize(1)));
        ife.identify("u", map("plan", "pro"));
        ife.track("t");
        ife.page("/p", null);
        synchronized (api.requests) {
            for (MockApi.Recorded r : api.requests) {
                assertFalse(r.body.toString().toLowerCase().contains("secret"));
                assertFalse(r.headers.keySet().toString().toLowerCase().contains("secret"));
            }
        }
    }

    @Test
    void t15_flatten() {
        Map<String, Object> flat = Flatten.flatten(map("a", map("b", map("c", 1)), "list", Arrays.asList(1, 2), "plain", "x"));
        assertEquals(map("a_b_c", 1, "list", Arrays.asList(1, 2), "plain", "x"), flat);
    }

    @Test
    void queue_persists_across_restarts() throws Exception {
        MemoryStorage storage = new MemoryStorage();
        IForeventsAPIIntegration first = make(cfg().batchSize(100).flushIntervalMillis(10000).storage(storage).persistQueue(true));
        first.init();
        first.track(new TrackEvent("offline", null));
        assertTrue(storage.get("iforevents_queue").contains("offline"));
        IForeventsAPIIntegration second = make(cfg().batchSize(100).flushIntervalMillis(10000).storage(storage).persistQueue(true));
        second.init();
        assertEquals(1, second.queuedEvents());
        second.flush();
        assertEquals(1, api.byPath("/v1/events/batch").size());
        assertNull(storage.get("iforevents_queue"));
    }

    @Test
    void calls_before_init_ignored() {
        Iforevents ife = Iforevents.builder().integration(make(cfg())).build();
        assertTrue(ife.track("early").isEmpty());
        assertTrue(ife.identify("u", null).isEmpty());
        assertEquals(0, api.requests.size());
    }

    @Test
    void identify_attributes_even_when_profile_request_fails() {
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                return req.path.equals("/v1/events/identify") && MockApi.send(ex, 500, "{\"error\":\"down\"}", null);
            }
        };
        IForeventsAPIIntegration integration = make(cfg().batchSize(1).maxRetries(0));
        Iforevents ife = boot(integration);
        ife.identify("user_x", null);
        assertEquals("user_x", integration.userId());
        ife.track("still_attributed");
        assertEquals("user_x", api.byPath("/v1/events/track").get(0).header("X-User-Id"));
    }

    @Test
    void throw_on_error_raises_and_recovers() throws Exception {
        api.scenario = new MockApi.Scenario() {
            @Override
            public boolean handle(MockApi.Recorded req, HttpExchange ex) throws IOException {
                return MockApi.send(ex, 500, "{\"error\":\"down\"}", null);
            }
        };
        final IForeventsAPIIntegration integration = make(cfg().maxRetries(0).throwOnError(true).batchSize(500));
        Iforevents ife = boot(integration);
        List<IntegrationResult> r = ife.identify("u", null);
        assertFalse(r.get(0).success);
        assertTrue(r.get(0).error.getMessage().contains("down"));
        ife.track("x");
        assertThrows(IForeventsAPIException.class, new org.junit.jupiter.api.function.Executable() {
            @Override
            public void execute() throws Throwable {
                integration.flush();
            }
        });
        api.scenario = null;
        integration.flush();
        List<MockApi.Recorded> batches = api.byPath("/v1/events/batch");
        assertEquals(1, names(batches.get(batches.size() - 1)).size());
    }

    @Test
    void concurrent_tracks_all_delivered() throws Exception {
        final IForeventsAPIIntegration integration = make(cfg().batchSize(7).flushIntervalMillis(10000));
        final Iforevents ife = boot(integration);
        List<Thread> threads = new ArrayList<Thread>();
        for (int i = 0; i < 8; i++) {
            final int id = i;
            Thread t = new Thread(new Runnable() {
                @Override
                public void run() {
                    for (int n = 0; n < 20; n++) ife.track("t", map("i", id, "n", n));
                }
            });
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) t.join();
        ife.flush();
        int total = 0;
        for (MockApi.Recorded b : api.byPath("/v1/events/batch")) total += names(b).size();
        assertEquals(160, total);
        assertEquals(0, integration.queuedEvents());
    }

    @Test
    void json_roundtrip() {
        String enc = com.iforevents.internal.Json.encode(map("s", "a\"b\n", "n", 1.5, "i", 3, "b", true, "nil", null, "list", Arrays.asList(1, "x"), "m", map("k", "v")));
        assertEquals("{\"s\":\"a\\\"b\\n\",\"n\":1.5,\"i\":3,\"b\":true,\"nil\":null,\"list\":[1,\"x\"],\"m\":{\"k\":\"v\"}}", enc);
        Map<String, Object> dec = com.iforevents.internal.Json.decodeObject(enc);
        assertEquals("a\"b\n", dec.get("s"));
        assertEquals(1.5, dec.get("n"));
        assertEquals(3L, dec.get("i"));
        assertEquals(Boolean.TRUE, dec.get("b"));
        assertNull(dec.get("nil"));
        assertEquals(Arrays.asList(1L, "x"), dec.get("list"));
        assertEquals(map("k", "v"), dec.get("m"));
        assertEquals("\u00e9", com.iforevents.internal.Json.decode("\"\\u00e9\""));
    }
}
