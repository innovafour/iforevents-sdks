package com.iforevents;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/** A page (web) or screen (mobile) view. */
public final class PageEvent {
    public final String name;
    public final Map<String, Object> properties;
    public final String navigationType;
    public final String toRoute;
    public final String previousRoute;
    public final Date timestamp;

    public PageEvent(String name, Map<String, ?> properties) {
        this(name, properties, null, null, null);
    }

    public PageEvent(String name, Map<String, ?> properties, String navigationType, String toRoute, String previousRoute) {
        this.name = name == null || name.isEmpty() ? "page_view" : name;
        this.properties = Collections.unmodifiableMap(new LinkedHashMap<String, Object>(properties == null ? Collections.<String, Object>emptyMap() : properties));
        this.navigationType = navigationType;
        this.toRoute = toRoute;
        this.previousRoute = previousRoute;
        this.timestamp = new Date();
    }
}
