package com.iforevents;

/** Implemented by every destination. Extend {@link BaseIntegration} for defaults and hooks. */
public interface Integration {
    String name();

    void init() throws Exception;

    void identify(IdentifyEvent event) throws Exception;

    void track(TrackEvent event) throws Exception;

    void page(PageEvent event) throws Exception;

    void reset() throws Exception;

    /** Sends anything buffered. */
    void flush() throws Exception;

    /** Flushes and releases resources. */
    void shutdown() throws Exception;
}
