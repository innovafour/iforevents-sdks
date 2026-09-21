package com.iforevents;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/** A tracked event ready for every integration. {@link #type} is {@code track} or {@code page_view}. */
public final class TrackEvent {
    public static final String TYPE_TRACK = "track";
    public static final String TYPE_PAGE_VIEW = "page_view";

    public final String name;
    public final String type;
    public final Map<String, Object> properties;
    /** When the event was queued; sent as {@code created_at}. */
    public final Date timestamp;

    public TrackEvent(String name, Map<String, ?> properties) {
        this(name, TYPE_TRACK, properties, new Date());
    }

    public TrackEvent(String name, String type, Map<String, ?> properties, Date timestamp) {
        this.name = name;
        this.type = type == null || type.isEmpty() ? TYPE_TRACK : type;
        this.properties = Collections.unmodifiableMap(new LinkedHashMap<String, Object>(properties == null ? Collections.<String, Object>emptyMap() : properties));
        this.timestamp = timestamp == null ? new Date() : timestamp;
    }
}
