package com.iforevents.integrations.amplitude;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.amplitude.Event;
import com.iforevents.Iforevents;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AmplitudeIntegrationTest {
    @Test
    void forwardsWithDeviceIdThenUserId() {
        final List<Event> events = new ArrayList<Event>();
        final int[] flushes = {0};
        final int[] shutdowns = {0};
        AmplitudeIntegration amp = new AmplitudeIntegration("k", new AmplitudeIntegration.Client() {
            @Override
            public void logEvent(Event e) {
                events.add(e);
            }

            @Override
            public void flush() {
                flushes[0]++;
            }

            @Override
            public void shutdown() {
                shutdowns[0]++;
            }
        }, "srv-1", null);
        Iforevents ife = Iforevents.builder().integration(amp).context(new Iforevents.ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return Collections.emptyMap();
            }
        }).build();
        ife.init();
        ife.track("anon");
        ife.identify("u", Collections.singletonMap("tier", "gold"));
        ife.track("paid", Collections.singletonMap("amount", 1));
        ife.page("Home", null);
        ife.flush();
        ife.shutdown();
        assertEquals(4, events.size());
        assertEquals("srv-1", events.get(0).deviceId);
        assertNull(events.get(0).userId);
        assertEquals("$identify", events.get(1).eventType);
        assertEquals("gold", events.get(1).userProperties.getJSONObject("$set").getString("tier"));
        assertEquals("u", events.get(2).userId);
        assertEquals(1, events.get(2).eventProperties.getInt("amount"));
        assertEquals("gold", events.get(2).eventProperties.getString("tier"));
        assertTrue(events.get(2).timestamp > 0);
        assertEquals("Home", events.get(3).eventType);
        assertEquals(1, flushes[0]);
        assertEquals(1, shutdowns[0]);
    }
}
