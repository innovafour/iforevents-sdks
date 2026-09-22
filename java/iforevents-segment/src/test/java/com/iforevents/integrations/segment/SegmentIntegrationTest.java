package com.iforevents.integrations.segment;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.iforevents.Iforevents;
import com.segment.analytics.messages.IdentifyMessage;
import com.segment.analytics.messages.Message;
import com.segment.analytics.messages.MessageBuilder;
import com.segment.analytics.messages.PageMessage;
import com.segment.analytics.messages.TrackMessage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SegmentIntegrationTest {
    @Test
    void forwardsAnonymousThenIdentified() {
        final List<Message> msgs = new ArrayList<Message>();
        final int[] shutdowns = {0};
        SegmentIntegration seg = new SegmentIntegration(new SegmentIntegration.Sink() {
            @Override
            public void enqueue(MessageBuilder<?, ?> m) {
                msgs.add(m.build());
            }

            @Override
            public void flush() {}

            @Override
            public void shutdown() {
                shutdowns[0]++;
            }
        }, "server", null);
        Iforevents ife = Iforevents.builder().integration(seg).context(new Iforevents.ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return Collections.emptyMap();
            }
        }).build();
        ife.init();
        ife.track("anon");
        ife.identify("u", Collections.singletonMap("plan", "pro"));
        ife.track("paid", Collections.singletonMap("amount", 1));
        ife.page("Home", null, null, "/", null);
        ife.reset();
        ife.track("again");
        ife.shutdown();
        assertEquals(5, msgs.size());
        TrackMessage anon = (TrackMessage) msgs.get(0);
        assertEquals("server", anon.anonymousId());
        assertNull(anon.userId());
        IdentifyMessage id = (IdentifyMessage) msgs.get(1);
        assertEquals("u", id.userId());
        assertEquals("pro", id.traits().get("plan"));
        TrackMessage paid = (TrackMessage) msgs.get(2);
        assertEquals("u", paid.userId());
        assertEquals(1, paid.properties().get("amount"));
        assertEquals("pro", paid.properties().get("plan"));
        PageMessage page = (PageMessage) msgs.get(3);
        assertEquals("Home", page.name());
        assertEquals("/", page.properties().get("to_route"));
        assertEquals("server", ((TrackMessage) msgs.get(4)).anonymousId());
        assertEquals(1, shutdowns[0]);
    }
}
