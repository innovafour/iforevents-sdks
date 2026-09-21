package com.iforevents;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * The facade: one {@link #init()}, then {@link #identify}, {@link #track},
 * {@link #page}, {@link #reset}, {@link #flush} and {@link #shutdown} fan out
 * to every integration in isolation. Identify traits are remembered and
 * merged under later track properties; nested maps are flattened with
 * {@code _}. Mirrors the {@code Iforevents} class of the Flutter package.
 */
public class Iforevents {
    /** Supplies platform context merged into identify traits. */
    public interface ContextProvider {
        Map<String, Object> get();
    }

    /** Observes the outcome of every fan-out. */
    public interface ResultObserver {
        void onResults(List<IntegrationResult> results);
    }

    private static final Logger LOG = Logger.getLogger("iforevents");

    private final List<Integration> integrations = new ArrayList<Integration>();
    private final ContextProvider context;
    private final boolean debug;
    private final ResultObserver observer;
    private volatile Map<String, Object> traits = Collections.emptyMap();
    private volatile boolean initialized;

    private Iforevents(Builder b) {
        this.integrations.addAll(b.integrations);
        this.context = b.context;
        this.debug = b.debug;
        this.observer = b.observer;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private final List<Integration> integrations = new ArrayList<Integration>();
        private ContextProvider context = new ContextProvider() {
            @Override
            public Map<String, Object> get() {
                return Context.defaultContext();
            }
        };
        private boolean debug;
        private ResultObserver observer;

        public Builder integration(Integration i) { integrations.add(i); return this; }
        public Builder integrations(List<? extends Integration> list) { integrations.addAll(list); return this; }
        public Builder context(ContextProvider c) { context = c; return this; }
        public Builder debug(boolean d) { debug = d; return this; }
        public Builder resultObserver(ResultObserver o) { observer = o; return this; }
        public Iforevents build() { return new Iforevents(this); }
    }

    public boolean isInitialized() { return initialized; }

    /** A copy of the traits remembered from the last identify. */
    public Map<String, Object> currentTraits() { return new LinkedHashMap<String, Object>(traits); }

    public synchronized void addIntegration(Integration i) { integrations.add(i); }

    public Integration integration(String name) {
        for (Integration i : integrations) if (i.name().equals(name)) return i;
        return null;
    }

    /** Initializes every integration. Failures are reported, never thrown. */
    public List<IntegrationResult> init() {
        List<IntegrationResult> results = fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.init(); }
        });
        initialized = true;
        return results;
    }

    public List<IntegrationResult> identify(final String customId, Map<String, ?> traits) {
        if (customId == null || customId.isEmpty() || !ready("identify")) return Collections.emptyList();
        Map<String, Object> merged = new LinkedHashMap<String, Object>(safeContext());
        if (traits != null) merged.putAll(traits);
        final Map<String, Object> flat = Flatten.flatten(merged);
        List<IntegrationResult> results = fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.identify(new IdentifyEvent(customId, flat)); }
        });
        this.traits = flat;
        return results;
    }

    public List<IntegrationResult> track(String name, Map<String, ?> properties) {
        if (name == null || name.isEmpty() || !ready("track")) return Collections.emptyList();
        Map<String, Object> merged = new LinkedHashMap<String, Object>(traits);
        if (properties != null) merged.putAll(properties);
        final TrackEvent event = new TrackEvent(name, Flatten.flatten(merged));
        return fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.track(event); }
        });
    }

    public List<IntegrationResult> track(String name) { return track(name, null); }

    public List<IntegrationResult> page(String name, Map<String, ?> properties) { return page(name, properties, null, null, null); }

    public List<IntegrationResult> page(String name, Map<String, ?> properties, String navigationType, String toRoute, String previousRoute) {
        if (!ready("page")) return Collections.emptyList();
        final PageEvent event = new PageEvent(name, Flatten.flatten(properties), navigationType, toRoute, previousRoute);
        return fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.page(event); }
        });
    }

    /** {@link #page} with mobile naming. */
    public List<IntegrationResult> screen(String name, Map<String, ?> properties) { return page(name, properties); }

    /** Forgets the user in every integration (logout). */
    public List<IntegrationResult> reset() {
        if (!ready("reset")) return Collections.emptyList();
        List<IntegrationResult> results = fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.reset(); }
        });
        traits = Collections.emptyMap();
        return results;
    }

    public List<IntegrationResult> flush() {
        return fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.flush(); }
        });
    }

    /** Flushes and releases every integration; the instance is no longer usable. */
    public List<IntegrationResult> shutdown() {
        List<IntegrationResult> results = fanOut(new Action() {
            @Override
            public void run(Integration i) throws Exception { i.shutdown(); }
        });
        initialized = false;
        return results;
    }

    private interface Action {
        void run(Integration i) throws Exception;
    }

    private boolean ready(String method) {
        if (initialized) return true;
        if (debug) LOG.log(Level.WARNING, "[iforevents] " + method + " called before init; ignored");
        return false;
    }

    private Map<String, Object> safeContext() {
        try {
            Map<String, Object> c = context == null ? null : context.get();
            return c == null ? Collections.<String, Object>emptyMap() : c;
        } catch (RuntimeException e) {
            if (debug) LOG.log(Level.WARNING, "[iforevents] context provider failed", e);
            return Collections.emptyMap();
        }
    }

    /** Runs one integration call in isolation and reports the outcome. */
    public static IntegrationResult safeExecute(Integration integration, Callable<Void> action) {
        try {
            action.call();
            return new IntegrationResult(integration.name(), true, null);
        } catch (Throwable t) {
            return new IntegrationResult(integration.name(), false, t);
        }
    }

    private List<IntegrationResult> fanOut(final Action action) {
        List<Integration> snapshot;
        synchronized (this) {
            snapshot = new ArrayList<Integration>(integrations);
        }
        List<IntegrationResult> results = new ArrayList<IntegrationResult>(snapshot.size());
        for (final Integration i : snapshot) {
            IntegrationResult r = safeExecute(i, new Callable<Void>() {
                @Override
                public Void call() throws Exception {
                    action.run(i);
                    return null;
                }
            });
            if (!r.success && debug) LOG.log(Level.WARNING, "[iforevents] " + r.integration + " failed", r.error);
            results.add(r);
        }
        if (observer != null) observer.onResults(results);
        return results;
    }
}
