package com.iforevents;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** The app's own user id plus traits (context merged in, nested maps flattened). */
public final class IdentifyEvent {
    public final String customId;
    public final Map<String, Object> traits;

    public IdentifyEvent(String customId, Map<String, ?> traits) {
        this.customId = customId;
        this.traits = Collections.unmodifiableMap(new LinkedHashMap<String, Object>(traits == null ? Collections.<String, Object>emptyMap() : traits));
    }
}
