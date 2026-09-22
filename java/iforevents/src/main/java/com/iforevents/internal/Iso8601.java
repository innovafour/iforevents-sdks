package com.iforevents.internal;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** RFC 3339 UTC timestamps with milliseconds (Java 8 and Android safe). */
public final class Iso8601 {
    private Iso8601() {}

    public static String format(Date date) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(date);
    }
}
