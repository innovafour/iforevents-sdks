package com.iforevents;

import java.util.concurrent.ConcurrentHashMap;

/** Default storage: nothing survives the process. */
public final class MemoryStorage implements Storage {
    private final ConcurrentHashMap<String, String> data = new ConcurrentHashMap<String, String>();

    @Override
    public String get(String key) {
        return data.get(key);
    }

    @Override
    public void set(String key, String value) {
        data.put(key, value);
    }

    @Override
    public void remove(String key) {
        data.remove(key);
    }
}
