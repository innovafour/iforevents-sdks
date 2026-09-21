package com.iforevents.integrations.segment;

import com.iforevents.BaseIntegration;
import com.iforevents.Hooks;
import com.iforevents.IdentifyEvent;
import com.iforevents.PageEvent;
import com.iforevents.TrackEvent;
import com.segment.analytics.Analytics;
import com.segment.analytics.messages.IdentifyMessage;
import com.segment.analytics.messages.MessageBuilder;
import com.segment.analytics.messages.PageMessage;
import com.segment.analytics.messages.TrackMessage;
import java.util.LinkedHashMap;
import java.util.Map;

/** Forwards calls to Segment through {@code analytics-java}. Mirrors {@code iforevents_segment}. */
public class SegmentIntegration extends BaseIntegration {
    /** What the adapter needs from the vendor; {@link Analytics} is adapted in {@link #of}. */
    public interface Sink {
        void enqueue(MessageBuilder<?, ?> message);

        void flush();

        void shutdown();
    }

    private final Sink sink;
    private final String anonymousId;
    private volatile String userId;

    public SegmentIntegration(String writeKey) {
        this(of(Analytics.builder(writeKey).build()), "server", null);
    }

    public SegmentIntegration(Sink sink, String anonymousId, Hooks hooks) {
        super("SegmentIntegration", hooks);
        this.sink = sink;
        this.anonymousId = anonymousId == null ? "server" : anonymousId;
    }

    public static Sink of(final Analytics analytics) {
        return new Sink() {
            @Override
            public void enqueue(MessageBuilder<?, ?> message) {
                analytics.enqueue(message);
            }

            @Override
            public void flush() {
                analytics.flush();
            }

            @Override
            public void shutdown() {
                analytics.shutdown();
            }
        };
    }

    private <T extends com.segment.analytics.messages.Message, V extends MessageBuilder<T, V>> V who(V builder) {
        String uid = userId;
        return uid != null ? builder.userId(uid) : builder.anonymousId(anonymousId);
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        super.identify(event);
        userId = event.customId;
        sink.enqueue(IdentifyMessage.builder().userId(event.customId).traits(event.traits));
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        super.track(event);
        sink.enqueue(who(TrackMessage.builder(event.name)).properties(event.properties).timestamp(event.timestamp));
    }

    @Override
    public void page(PageEvent event) throws Exception {
        super.page(event);
        Map<String, Object> props = new LinkedHashMap<String, Object>(event.properties);
        if (event.navigationType != null) props.put("navigation_type", event.navigationType);
        if (event.toRoute != null) props.put("to_route", event.toRoute);
        if (event.previousRoute != null) props.put("previous_route", event.previousRoute);
        sink.enqueue(who(PageMessage.builder(event.name)).properties(props).timestamp(event.timestamp));
    }

    @Override
    public void reset() throws Exception {
        super.reset();
        userId = null;
    }

    @Override
    public void flush() throws Exception {
        sink.flush();
    }

    @Override
    public void shutdown() throws Exception {
        sink.shutdown();
    }
}
