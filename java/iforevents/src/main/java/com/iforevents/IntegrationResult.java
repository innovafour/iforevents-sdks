package com.iforevents;

import java.util.Date;

/** Outcome of one integration call; the facade never throws for these. */
public final class IntegrationResult {
    public final String integration;
    public final boolean success;
    public final Throwable error;
    public final Date timestamp = new Date();

    public IntegrationResult(String integration, boolean success, Throwable error) {
        this.integration = integration;
        this.success = success;
        this.error = error;
    }

    @Override
    public String toString() {
        return "IntegrationResult{" + integration + ", success=" + success + (error == null ? "" : ", error=" + error) + "}";
    }
}
