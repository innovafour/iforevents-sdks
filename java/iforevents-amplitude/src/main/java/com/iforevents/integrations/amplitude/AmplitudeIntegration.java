package com.iforevents.integrations.amplitude;

import com.amplitude.Amplitude;
import com.amplitude.Event;
import com.iforevents.BaseIntegration;
import com.iforevents.Hooks;
import com.iforevents.IdentifyEvent;
import com.iforevents.PageEvent;
import com.iforevents.TrackEvent;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONObject;

/** Forwards calls to Amplitude through the {@code java-sdk}. Mirrors {@code iforevents_amplitude}. */
public class AmplitudeIntegration extends BaseIntegration {
    /** What the adapter needs from the vendor; {@link Amplitude} is adapted in {@link #of}. */
    public interface Client {
        void logEvent(Event event);

        void flush();

        void shutdown() throws Exception;
    }

    private final String apiKey;
    private final Client client;
    private final String deviceId;
    private volatile String userId;

    public AmplitudeIntegration(String apiKey) {
        this(apiKey, null, "server", null);
    }

    public AmplitudeIntegration(String apiKey, Client client, String deviceId, Hooks hooks) {
        super("AmplitudeIntegration", hooks);
        if (client == null && (apiKey == null || apiKey.isEmpty())) throw new IllegalArgumentException("AmplitudeIntegration needs an apiKey or a client");
        this.apiKey = apiKey;
        this.client = client != null ? client : of(apiKey);
        this.deviceId = deviceId == null ? "server" : deviceId;
    }

    private static Client of(String apiKey) {
        final Amplitude amp = Amplitude.getInstance("iforevents");
        amp.init(apiKey);
        return new Client() {
            @Override
            public void logEvent(Event event) {
                amp.logEvent(event);
            }

            @Override
            public void flush() {
                amp.flushEvents();
            }

            @Override
            public void shutdown() throws Exception {
                amp.shutdown();
            }
        };
    }

    public String apiKey() {
        return apiKey;
    }

    private Event newEvent(String type, long timestampMillis) {
        String uid = userId;
        Event e = uid != null ? new Event(type, uid) : new Event(type, null, deviceId);
        e.timestamp = timestampMillis;
        return e;
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        super.identify(event);
        userId = event.customId;
        Event e = new Event("$identify", event.customId);
        e.userProperties = new JSONObject().put("$set", new JSONObject(scalarize(event.traits)));
        client.logEvent(e);
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        super.track(event);
        Event e = newEvent(event.name, event.timestamp.getTime());
        e.eventProperties = new JSONObject(scalarize(event.properties));
        client.logEvent(e);
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
        userId = null;
    }

    @Override
    public void flush() throws Exception {
        client.flush();
    }

    @Override
    public void shutdown() throws Exception {
        client.shutdown();
    }

    private static Map<String, Object> scalarize(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        for (Map.Entry<String, Object> e : in.entrySet()) if (e.getValue() != null) out.put(e.getKey(), e.getValue());
        return out;
    }
}
