package com.iforevents.integrations.mixpanel;

import com.iforevents.BaseIntegration;
import com.iforevents.Hooks;
import com.iforevents.IdentifyEvent;
import com.iforevents.PageEvent;
import com.iforevents.TrackEvent;
import com.mixpanel.mixpanelapi.MessageBuilder;
import com.mixpanel.mixpanelapi.MixpanelAPI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * Forwards calls to Mixpanel through {@code mixpanel-java}. Messages are sent
 * synchronously by the vendor library. Mirrors {@code iforevents_mixpanel}.
 */
public class MixpanelIntegration extends BaseIntegration {
    /** What the adapter needs from the vendor; {@link MixpanelAPI} is adapted in {@link #of}. */
    public interface Sender {
        void send(JSONObject message) throws Exception;
    }

    private final String token;
    private final MessageBuilder messages;
    private final Sender sender;
    private final String anonymousId;
    private volatile String distinctId;

    public MixpanelIntegration(String token) {
        this(token, of(new MixpanelAPI()), "server", null);
    }

    public MixpanelIntegration(String token, Sender sender, String anonymousId, Hooks hooks) {
        super("MixpanelIntegration", hooks);
        if (token == null || token.isEmpty()) throw new IllegalArgumentException("MixpanelIntegration needs a token");
        this.token = token;
        this.messages = new MessageBuilder(token);
        this.sender = sender;
        this.anonymousId = anonymousId == null ? "server" : anonymousId;
    }

    public static Sender of(final MixpanelAPI api) {
        return new Sender() {
            @Override
            public void send(JSONObject message) throws Exception {
                api.sendMessage(message);
            }
        };
    }

    public String token() {
        return token;
    }

    private String who() {
        String id = distinctId;
        return id == null ? anonymousId : id;
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        super.identify(event);
        distinctId = event.customId;
        sender.send(messages.set(event.customId, new JSONObject(scalarize(event.traits))));
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        super.track(event);
        Map<String, Object> props = scalarize(event.properties);
        props.put("time", event.timestamp.getTime() / 1000L);
        sender.send(messages.event(who(), event.name, new JSONObject(props)));
    }

    @Override
    public void page(PageEvent event) throws Exception {
        super.page(event);
        Map<String, Object> props = new LinkedHashMap<String, Object>(event.properties);
        props.put("navigation_type", event.navigationType);
        props.put("to_route", event.toRoute);
        props.put("previous_route", event.previousRoute);
        track(new TrackEvent(event.name, TrackEvent.TYPE_PAGE_VIEW, props, event.timestamp));
    }

    @Override
    public void reset() throws Exception {
        super.reset();
        distinctId = null;
    }

    private static Map<String, Object> scalarize(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        for (Map.Entry<String, Object> e : in.entrySet()) if (e.getValue() != null) out.put(e.getKey(), e.getValue());
        return out;
    }
}
