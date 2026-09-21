package com.iforevents;

import com.iforevents.internal.Json;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Tiny ingest api double: records requests, answers like the real api, supports fault injection. */
final class MockApi {
    static final class Recorded {
        final String path;
        final Map<String, String> headers = new LinkedHashMap<String, String>();
        final Map<String, Object> body;

        Recorded(String path, Map<String, Object> body) {
            this.path = path;
            this.body = body;
        }

        String header(String name) {
            return headers.get(name.toLowerCase());
        }
    }

    interface Scenario {
        /** @return true when it answered. */
        boolean handle(Recorded req, HttpExchange ex) throws IOException;
    }

    private final HttpServer server;
    final List<Recorded> requests = Collections.synchronizedList(new ArrayList<Recorded>());
    volatile Scenario scenario;
    final String baseUrl;

    MockApi() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", new com.sun.net.httpserver.HttpHandler() {
            @Override
            public void handle(HttpExchange ex) throws IOException {
                String raw = readAll(ex.getRequestBody());
                Recorded rec = new Recorded(ex.getRequestURI().getPath(), Json.decodeObject(raw));
                for (Map.Entry<String, List<String>> h : ex.getRequestHeaders().entrySet()) {
                    rec.headers.put(h.getKey().toLowerCase(), h.getValue().get(0));
                }
                requests.add(rec);
                Scenario s = scenario;
                if (s != null && s.handle(rec, ex)) return;
                if (!"pk_test".equals(rec.header("X-Project-Key"))) {
                    send(ex, 401, "{\"error\":\"invalid project key\"}", null);
                    return;
                }
                if (rec.path.equals("/v1/events/identify")) send(ex, 201, "{\"user\":{\"uuid\":\"11111111-1111-4111-8111-111111111111\"}}", null);
                else if (rec.path.equals("/v1/events/track")) send(ex, 201, "{\"status\":\"ok\",\"user_uuid\":\"22222222-2222-4222-8222-222222222222\"}", null);
                else if (rec.path.equals("/v1/events/batch")) send(ex, 202, "{\"status\":\"queued\",\"user_uuid\":\"33333333-3333-4333-8333-333333333333\"}", null);
                else send(ex, 404, "{\"error\":\"not found\"}", null);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    void stop() {
        server.stop(0);
    }

    void reset() {
        requests.clear();
        scenario = null;
    }

    List<Recorded> byPath(String path) {
        List<Recorded> out = new ArrayList<Recorded>();
        synchronized (requests) {
            for (Recorded r : requests) if (r.path.equals(path)) out.add(r);
        }
        return out;
    }

    static boolean send(HttpExchange ex, int status, String body, Map<String, String> headers) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) ex.getResponseHeaders().set(h.getKey(), h.getValue());
        ex.sendResponseHeaders(status, bytes.length);
        OutputStream out = ex.getResponseBody();
        out.write(bytes);
        out.close();
        return true;
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
