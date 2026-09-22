package com.iforevents.internal;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON encoder and decoder so the SDK has no runtime dependency and
 * runs unchanged on Android. Encodes maps, collections, arrays, numbers,
 * booleans, strings, dates (ISO 8601) and falls back to {@code toString()}.
 */
public final class Json {
    private Json() {}

    public static String encode(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder sb, Object v) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String) {
            writeString(sb, (String) v);
        } else if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else sb.append(v.toString());
        } else if (v instanceof Boolean) {
            sb.append(v.toString());
        } else if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<Object, Object> e : ((Map<Object, Object>) v).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(sb, String.valueOf(e.getKey()));
                sb.append(':');
                write(sb, e.getValue());
            }
            sb.append('}');
        } else if (v instanceof Collection) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Collection<Object>) v) {
                if (!first) sb.append(',');
                first = false;
                write(sb, item);
            }
            sb.append(']');
        } else if (v.getClass().isArray()) {
            sb.append('[');
            int n = java.lang.reflect.Array.getLength(v);
            for (int i = 0; i < n; i++) {
                if (i > 0) sb.append(',');
                write(sb, java.lang.reflect.Array.get(v, i));
            }
            sb.append(']');
        } else if (v instanceof Date) {
            writeString(sb, Iso8601.format((Date) v));
        } else {
            writeString(sb, v.toString());
        }
    }

    private static void writeString(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    /** Decodes a document; objects become {@link LinkedHashMap}, arrays {@link ArrayList}, numbers {@link Double} or {@link Long}. */
    public static Object decode(String text) {
        if (text == null) return null;
        Parser p = new Parser(text);
        p.skipWs();
        if (p.pos >= text.length()) return null;
        Object v = p.value();
        return v;
    }

    /** Decodes and returns the object, or an empty map when the body is not a JSON object. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> decodeObject(String text) {
        try {
            Object v = decode(text);
            return v instanceof Map ? (Map<String, Object>) v : new LinkedHashMap<String, Object>();
        } catch (RuntimeException e) {
            return new LinkedHashMap<String, Object>();
        }
    }

    private static final class Parser {
        private final String s;
        private int pos;

        Parser(String s) { this.s = s; }

        void skipWs() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++;
        }

        Object value() {
            skipWs();
            if (pos >= s.length()) throw new IllegalArgumentException("unexpected end of json");
            char c = s.charAt(pos);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': expect("true"); return Boolean.TRUE;
                case 'f': expect("false"); return Boolean.FALSE;
                case 'n': expect("null"); return null;
                default: return number();
            }
        }

        private void expect(String word) {
            if (!s.startsWith(word, pos)) throw new IllegalArgumentException("bad json at " + pos);
            pos += word.length();
        }

        private Map<String, Object> object() {
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            pos++; // {
            skipWs();
            if (s.charAt(pos) == '}') { pos++; return out; }
            while (true) {
                skipWs();
                String key = string();
                skipWs();
                if (s.charAt(pos) != ':') throw new IllegalArgumentException("expected : at " + pos);
                pos++;
                out.put(key, value());
                skipWs();
                char c = s.charAt(pos++);
                if (c == '}') return out;
                if (c != ',') throw new IllegalArgumentException("expected , at " + pos);
            }
        }

        private List<Object> array() {
            List<Object> out = new ArrayList<Object>();
            pos++; // [
            skipWs();
            if (s.charAt(pos) == ']') { pos++; return out; }
            while (true) {
                out.add(value());
                skipWs();
                char c = s.charAt(pos++);
                if (c == ']') return out;
                if (c != ',') throw new IllegalArgumentException("expected , at " + pos);
            }
        }

        private String string() {
            if (s.charAt(pos) != '"') throw new IllegalArgumentException("expected string at " + pos);
            pos++;
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(pos++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                            pos += 4;
                            break;
                        default: throw new IllegalArgumentException("bad escape at " + pos);
                    }
                } else {
                    sb.append(c);
                }
            }
        }

        private Object number() {
            int start = pos;
            while (pos < s.length() && "+-0123456789.eE".indexOf(s.charAt(pos)) >= 0) pos++;
            String raw = s.substring(start, pos);
            if (raw.isEmpty()) throw new IllegalArgumentException("bad json at " + pos);
            if (raw.indexOf('.') < 0 && raw.indexOf('e') < 0 && raw.indexOf('E') < 0) {
                try { return Long.parseLong(raw); } catch (NumberFormatException ignored) { /* fall through */ }
            }
            return Double.parseDouble(raw);
        }
    }
}
