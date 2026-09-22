package com.iforevents.integrations.mixpanel;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.iforevents.Iforevents;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;

class MixpanelIntegrationTest {
    @Test
    void forwardsIdentifyTrackPageReset() {
        final List<JSONObject> sent = new ArrayList<JSONObject>();
        MixpanelIntegration mp = new MixpanelIntegration("token", new MixpanelIntegration.Sender() {
            @Override
            public void send(JSONObject m) {
                sent.add(m);
            }
        }, "server", null);
        Iforevents ife = Iforevents.builder().integration(mp).context(new Iforevents.ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return Collections.emptyMap();
            }
        }).build();
        ife.init();
        ife.track("anon");
        Map<String, Object> traits = new LinkedHashMap<String, Object>();
        traits.put("plan", "pro");
        traits.put("nil", null);
        ife.identify("u", traits);
        ife.track("paid", Collections.singletonMap("amount", 1));
        ife.page("Home", null, "load", null, null);
        ife.reset();
        ife.track("again");
        assertEquals(5, sent.size());
        assertEquals("event", sent.get(0).getString("message_type"));
        assertEquals("server", sent.get(0).getJSONObject("message").getJSONObject("properties").getString("distinct_id"));
        JSONObject people = sent.get(1);
        assertEquals("people", people.getString("message_type"));
        assertEquals("u", people.getJSONObject("message").getString("$distinct_id"));
        assertEquals("pro", people.getJSONObject("message").getJSONObject("$set").getString("plan"));
        assertFalse(people.getJSONObject("message").getJSONObject("$set").has("nil"));
        JSONObject paid = sent.get(2).getJSONObject("message");
        assertEquals("paid", paid.getString("event"));
        assertEquals("u", paid.getJSONObject("properties").getString("distinct_id"));
        assertEquals(1, paid.getJSONObject("properties").getInt("amount"));
        assertTrue(paid.getJSONObject("properties").has("time"));
        assertEquals("Home", sent.get(3).getJSONObject("message").getString("event"));
        assertEquals("server", sent.get(4).getJSONObject("message").getJSONObject("properties").getString("distinct_id"));
    }
}
