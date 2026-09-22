package com.iforevents;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Real-api smoke: IFOREVENTS_PROJECT_KEY and IFOREVENTS_BASE_URL must be set. */
public final class Smoke {
    public static void main(String[] args) throws Exception {
        String key = System.getenv("IFOREVENTS_PROJECT_KEY");
        String base = System.getenv("IFOREVENTS_BASE_URL");
        if (base == null || base.isEmpty()) base = "https://api.iforevents.com";
        if (key == null || key.isEmpty()) {
            System.err.println("IFOREVENTS_PROJECT_KEY missing");
            System.exit(2);
        }
        final List<String> errors = new ArrayList<String>();
        IForeventsAPIIntegration api = new IForeventsAPIIntegration(APIConfig.builder(key).baseUrl(base).batchSize(2).flushOnShutdownHook(false).onError(new APIConfig.Callback<IForeventsAPIException>() {
            @Override
            public void call(IForeventsAPIException e) {
                errors.add(e.getMessage());
            }
        }).build());
        Iforevents ife = Iforevents.builder().integration(api).build();
        ife.init();
        Map<String, Object> traits = new LinkedHashMap<String, Object>();
        traits.put("email", "smoke@example.com");
        traits.put("plan", "free");
        Map<String, Object> nested = new LinkedHashMap<String, Object>();
        nested.put("deep", true);
        traits.put("nested", nested);
        List<IntegrationResult> id = ife.identify("smoke_java_" + System.currentTimeMillis(), traits);
        Map<String, Object> props = new LinkedHashMap<String, Object>();
        props.put("n", 1);
        ife.track("smoke_track", props);
        ife.page("/smoke", null);
        ife.shutdown();
        System.out.println("{\"identify\":" + id.get(0).success + ",\"user_id\":\"" + api.userId() + "\",\"queued\":" + api.queuedEvents() + ",\"errors\":" + errors + "}");
        System.exit(id.get(0).success && errors.isEmpty() && api.userId() != null ? 0 : 1);
    }
}
