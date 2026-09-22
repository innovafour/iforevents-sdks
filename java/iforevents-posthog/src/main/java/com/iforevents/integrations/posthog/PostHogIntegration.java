package com.iforevents.integrations.posthog;

import com.iforevents.BaseIntegration;
import com.iforevents.Hooks;
import com.iforevents.IdentifyEvent;
import com.iforevents.PageEvent;
import com.iforevents.TrackEvent;
import com.posthog.java.PostHog;
import java.util.LinkedHashMap;
import java.util.Map;

/** Forwards calls to PostHog through {@code posthog-java}. */
public class PostHogIntegration extends BaseIntegration {
    /** What the adapter needs from the vendor; {@link PostHog} is adapted in {@link #of}. */
    public interface Client {
        void capture(String distinctId, String event, Map<String, Object> properties);

        void identify(String distinctId, Map<String, Object> properties);

        void shutdown();
    }

    private final Client client;
    private final String anonymousId;
    private volatile String distinctId;

    public PostHogIntegration(String apiKey) {
        this(apiKey, "https://us.i.posthog.com");
    }

    public PostHogIntegration(String apiKey, String host) {
        this(of(new PostHog.Builder(apiKey).host(host).build()), "server", null);
    }

    public PostHogIntegration(Client client, String anonymousId, Hooks hooks) {
        super("PostHogIntegration", hooks);
        this.client = client;
        this.anonymousId = anonymousId == null ? "server" : anonymousId;
    }

    public static Client of(final PostHog posthog) {
        return new Client() {
            @Override
            public void capture(String distinctId, String event, Map<String, Object> properties) {
                posthog.capture(distinctId, event, properties);
            }

            @Override
            public void identify(String distinctId, Map<String, Object> properties) {
                posthog.identify(distinctId, properties);
            }

            @Override
            public void shutdown() {
                posthog.shutdown();
            }
        };
    }

    private String who() {
        String id = distinctId;
        return id == null ? anonymousId : id;
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        super.identify(event);
        distinctId = event.customId;
        client.identify(event.customId, new LinkedHashMap<String, Object>(event.traits));
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        super.track(event);
        client.capture(who(), event.name, new LinkedHashMap<String, Object>(event.properties));
    }

    @Override
    public void page(PageEvent event) throws Exception {
        super.page(event);
        Map<String, Object> props = new LinkedHashMap<String, Object>(event.properties);
        props.put("screen_name", event.name);
        if (event.navigationType != null) props.put("navigation_type", event.navigationType);
        if (event.toRoute != null) props.put("to_route", event.toRoute);
        if (event.previousRoute != null) props.put("previous_route", event.previousRoute);
        client.capture(who(), "$pageview", props);
    }

    @Override
    public void reset() throws Exception {
        super.reset();
        distinctId = null;
    }

    @Override
    public void shutdown() throws Exception {
        client.shutdown();
    }
}
