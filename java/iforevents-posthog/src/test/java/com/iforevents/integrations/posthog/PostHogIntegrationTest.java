package com.iforevents.integrations.posthog;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.iforevents.Iforevents;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PostHogIntegrationTest {
    @Test
    void forwardsWithDistinctIdSwitch() {
        final List<List<Object>> calls = new ArrayList<List<Object>>();
        PostHogIntegration ph = new PostHogIntegration(new PostHogIntegration.Client() {
            @Override
            public void capture(String id, String event, Map<String, Object> p) {
                calls.add(Arrays.<Object>asList("capture", id, event, p));
            }

            @Override
            public void identify(String id, Map<String, Object> p) {
                calls.add(Arrays.<Object>asList("identify", id, p));
            }

            @Override
            public void shutdown() {
                calls.add(Arrays.<Object>asList("shutdown"));
            }
        }, "server", null);
        Iforevents ife = Iforevents.builder().integration(ph).context(new Iforevents.ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return Collections.emptyMap();
            }
        }).build();
        ife.init();
        ife.track("anon");
        ife.identify("u", Collections.singletonMap("plan", "pro"));
        ife.track("paid");
        ife.page("Home", null);
        ife.shutdown();
        assertEquals("server", calls.get(0).get(1));
        assertEquals(Arrays.<Object>asList("identify", "u", Collections.singletonMap("plan", "pro")), calls.get(1));
        assertEquals("u", calls.get(2).get(1));
        assertEquals("$pageview", calls.get(3).get(2));
        assertEquals("Home", ((Map<?, ?>) calls.get(3).get(3)).get("screen_name"));
        assertEquals(Collections.singletonList("shutdown"), calls.get(4));
    }
}
