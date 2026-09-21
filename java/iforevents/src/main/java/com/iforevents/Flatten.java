package com.iforevents;

import java.util.LinkedHashMap;
import java.util.Map;

/** Flattens nested maps with {@code _}: {@code {a: {b: 1}}} becomes {@code {a_b: 1}}. */
public final class Flatten {
    private Flatten() {}

    public static Map<String, Object> flatten(Map<String, ?> in) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        if (in != null) into(out, "", in);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static void into(Map<String, Object> out, String prefix, Map<String, ?> in) {
        for (Map.Entry<String, ?> e : in.entrySet()) {
            String name = prefix.isEmpty() ? e.getKey() : prefix + "_" + e.getKey();
            Object v = e.getValue();
            if (v instanceof Map) into(out, name, (Map<String, ?>) v);
            else out.put(name, v);
        }
    }
}
