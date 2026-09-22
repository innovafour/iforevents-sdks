package com.iforevents;

/** Optional callbacks fired before an integration handles a call. All fields may stay null. */
public class Hooks {
    public Runnable onInit;
    public Consumer<IdentifyEvent> onIdentify;
    public Consumer<TrackEvent> onTrack;
    public Consumer<PageEvent> onPage;
    public Runnable onReset;

    /** Java 8 compatible consumer (java.util.function is fine on Android too, but keep the surface minimal). */
    public interface Consumer<T> {
        void accept(T value);
    }
}
