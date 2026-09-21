package com.iforevents;

import java.net.InetAddress;
import java.util.LinkedHashMap;
import java.util.Map;

/** Default context merged into identify traits, with the Flutter key names. */
public final class Context {
    public static final String SDK_NAME = "iforevents-java";
    public static final String SDK_VERSION = "0.1.0";

    private Context() {}

    public static Map<String, Object> defaultContext() {
        Map<String, Object> ctx = new LinkedHashMap<String, Object>();
        ctx.put("sdk_name", SDK_NAME);
        ctx.put("sdk_version", SDK_VERSION);
        ctx.put("runtime", "java/" + System.getProperty("java.version", ""));
        ctx.put("device_platform", "server");
        ctx.put("device_brand", System.getProperty("os.name", ""));
        ctx.put("device_model", System.getProperty("os.arch", ""));
        ctx.put("device_os_version", System.getProperty("os.version", ""));
        ctx.put("device_app_version", "");
        String host = "";
        try {
            host = InetAddress.getLocalHost().getHostName();
        } catch (Exception ignored) {
            // some sandboxes forbid the lookup
        }
        ctx.put("hostname", host);
        return ctx;
    }
}
