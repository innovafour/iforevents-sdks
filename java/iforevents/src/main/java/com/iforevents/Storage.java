package com.iforevents;

/** Keeps the user id (and the queue when persisted) across runs. */
public interface Storage {
    /** @return the value or null. */
    String get(String key);

    void set(String key, String value);

    void remove(String key);
}
