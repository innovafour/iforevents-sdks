package com.iforevents;

import com.iforevents.internal.Json;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** A JSON file, for CLIs, daemons and desktop apps that want the queue to survive restarts. */
public final class FileStorage implements Storage {
    private final File file;

    public FileStorage(File file) {
        this.file = file;
    }

    private synchronized Map<String, Object> read() {
        if (!file.exists()) return new LinkedHashMap<String, Object>();
        try {
            InputStream in = new FileInputStream(file);
            try {
                byte[] buf = new byte[(int) file.length()];
                int n = 0;
                while (n < buf.length) {
                    int r = in.read(buf, n, buf.length - n);
                    if (r < 0) break;
                    n += r;
                }
                return Json.decodeObject(new String(buf, 0, n, StandardCharsets.UTF_8));
            } finally {
                in.close();
            }
        } catch (IOException e) {
            return new LinkedHashMap<String, Object>();
        }
    }

    private synchronized void write(Map<String, Object> data) {
        File parent = file.getAbsoluteFile().getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        File tmp = new File(file.getAbsolutePath() + ".tmp");
        try {
            OutputStream out = new FileOutputStream(tmp);
            try {
                out.write(Json.encode(data).getBytes(StandardCharsets.UTF_8));
            } finally {
                out.close();
            }
            if (!tmp.renameTo(file)) {
                file.delete();
                tmp.renameTo(file);
            }
        } catch (IOException ignored) {
            // best effort: the in-memory state still drives the session
        }
    }

    @Override
    public synchronized String get(String key) {
        Object v = read().get(key);
        return v == null ? null : v.toString();
    }

    @Override
    public synchronized void set(String key, String value) {
        Map<String, Object> data = read();
        data.put(key, value);
        write(data);
    }

    @Override
    public synchronized void remove(String key) {
        Map<String, Object> data = read();
        if (data.remove(key) != null) write(data);
    }
}
