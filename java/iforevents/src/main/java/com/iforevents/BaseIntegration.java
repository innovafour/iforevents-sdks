package com.iforevents;

/** Defaults and hooks; mirrors the Flutter {@code Integration} base. Call {@code super} first in overrides. */
public abstract class BaseIntegration implements Integration {
    private final String name;
    protected final Hooks hooks;

    protected BaseIntegration(String name, Hooks hooks) {
        this.name = name == null ? getClass().getSimpleName() : name;
        this.hooks = hooks == null ? new Hooks() : hooks;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public void init() throws Exception {
        if (hooks.onInit != null) hooks.onInit.run();
    }

    @Override
    public void identify(IdentifyEvent event) throws Exception {
        if (hooks.onIdentify != null) hooks.onIdentify.accept(event);
    }

    @Override
    public void track(TrackEvent event) throws Exception {
        if (hooks.onTrack != null) hooks.onTrack.accept(event);
    }

    @Override
    public void page(PageEvent event) throws Exception {
        if (hooks.onPage != null) hooks.onPage.accept(event);
    }

    @Override
    public void reset() throws Exception {
        if (hooks.onReset != null) hooks.onReset.run();
    }

    @Override
    public void flush() throws Exception {}

    @Override
    public void shutdown() throws Exception {}
}
