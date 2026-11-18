package com.iforevents.android

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.iforevents.APIConfig
import com.iforevents.IForeventsAPIIntegration
import com.iforevents.Iforevents
import com.iforevents.Integration
import com.iforevents.IntegrationResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * The Android entry point. Wraps the JVM [Iforevents] facade so every call
 * runs on a background thread (network on the main thread is forbidden on
 * Android), keeps the user id and the queue in SharedPreferences, collects
 * device context, tracks screens from activity lifecycle callbacks and
 * flushes when the app goes to the background.
 *
 * ```kotlin
 * IforeventsAndroid.init(application, "pk_...") { batchSize(20) }
 * IforeventsAndroid.identify("user_123", mapOf("plan" to "pro"))
 * IforeventsAndroid.track("purchase_completed", mapOf("total" to 9.99))
 * ```
 */
class IforeventsAndroid private constructor(
    val iforevents: Iforevents,
    val api: IForeventsAPIIntegration?,
    private val executor: ExecutorService,
) {
    /** The session attribution; only touched on the worker thread. */
    private val attribution = AttributionTracker()

    class Options {
        /** Extra integrations besides the IForevents API (Firebase, Mixpanel, ...). */
        val integrations: MutableList<Integration> = mutableListOf()
        /** Track a screen view for every resumed Activity. Default true. */
        var trackActivities: Boolean = true
        /**
         * Record the deep link (Intent data) an Activity is opened with, as
         * [trackDeepLink] does, and attach the session attribution to every
         * event. Default true.
         */
        var trackDeepLinks: Boolean = true
        /** Flush when the last Activity stops. Default true. */
        var flushOnBackground: Boolean = true
        /** Extra context merged into identify traits. */
        var context: Map<String, Any?> = emptyMap()
        /** Log failures with android.util.Log. Default false. */
        var debug: Boolean = false
        /** Skip the IForevents API integration (adapters only). Default false. */
        var disableApi: Boolean = false
        /** Customize the API integration (baseUrl, batchSize, callbacks, ...). */
        var configure: (APIConfig.Builder.() -> Unit)? = null

        fun integration(i: Integration): Options = apply { integrations.add(i) }
    }

    private fun submit(block: () -> List<IntegrationResult>): Future<List<IntegrationResult>> = executor.submit<List<IntegrationResult>> {
        try {
            block()
        } catch (t: Throwable) {
            Log.w(TAG, "call failed", t)
            emptyList()
        }
    }

    fun identify(customId: String, traits: Map<String, Any?> = emptyMap()): Future<List<IntegrationResult>> = submit { iforevents.identify(customId, traits) }

    fun track(name: String, properties: Map<String, Any?> = emptyMap()): Future<List<IntegrationResult>> = submit { iforevents.track(name, attribution.apply(properties)) }

    fun screen(name: String, properties: Map<String, Any?> = emptyMap(), navigationType: String? = null, previousRoute: String? = null): Future<List<IntegrationResult>> =
        submit { iforevents.page(name, attribution.apply(properties), navigationType, name, previousRoute) }

    /**
     * Records an opened deep link or App Link: sends `deep_link_opened` with
     * the URL and starts the session attribution from its utm parameters
     * and click ids (plus the referring app or site), attached to every
     * event until 30 minutes pass without one. Activities opened with Intent
     * data are recorded automatically unless [Options.trackDeepLinks] is off.
     */
    @JvmOverloads
    fun trackDeepLink(url: String, referrer: String? = null, properties: Map<String, Any?> = emptyMap()): Future<List<IntegrationResult>> = submit {
        val landing = Attribution.fromUrl(url, referrer)
        val props = LinkedHashMap<String, Any?>().apply {
            put("url", url)
            if (!referrer.isNullOrEmpty()) put("referrer", referrer)
            putAll(properties)
        }
        iforevents.track("deep_link_opened", attribution.apply(props, landing))
    }

    /**
     * Sets the session attribution yourself, e.g. from the Play install
     * referrer: `setAttribution(Attribution.fromInstallReferrer(details.installReferrer))`.
     */
    fun setAttribution(values: Map<String, String>) {
        submit {
            attribution.touch(values)
            emptyList()
        }
    }

    fun reset(): Future<List<IntegrationResult>> = submit {
        attribution.clear()
        iforevents.reset()
    }

    fun flush(): Future<List<IntegrationResult>> = submit { iforevents.flush() }

    /** Flushes, releases integrations and stops the worker. Blocks up to [timeoutMillis]. */
    fun shutdown(timeoutMillis: Long = 5_000) {
        try {
            submit { iforevents.shutdown() }.get(timeoutMillis, TimeUnit.MILLISECONDS)
        } catch (t: Throwable) {
            Log.w(TAG, "shutdown timed out", t)
        }
        executor.shutdown()
    }

    companion object {
        private const val TAG = "IForevents"
        private const val HANDLED_EXTRA = "com.iforevents.android.deep_link_recorded"

        @Volatile
        private var shared: IforeventsAndroid? = null

        /** The instance created by [init]; throws before that. */
        @JvmStatic
        val instance: IforeventsAndroid
            get() = shared ?: throw IllegalStateException("IforeventsAndroid.init(context, projectKey) must run first")

        @JvmStatic
        fun isInitialized(): Boolean = shared != null

        /** Creates the shared instance once; later calls return it. Safe to call from Application.onCreate. */
        @JvmStatic
        @JvmOverloads
        fun init(context: Context, projectKey: String, configure: (Options.() -> Unit)? = null): IforeventsAndroid {
            shared?.let { return it }
            synchronized(this) {
                shared?.let { return it }
                val app = context.applicationContext
                val options = Options().apply { configure?.invoke(this) }
                val api = if (options.disableApi) null else IForeventsAPIIntegration(
                    APIConfig.builder(projectKey)
                        .storage(AndroidStorage(app))
                        .persistQueue(true)
                        .flushOnShutdownHook(false)
                        .debug(options.debug)
                        .apply { options.configure?.invoke(this) }
                        .build(),
                )
                val builder = Iforevents.builder()
                    .context { AndroidContext.collect(app, options.context) }
                    .debug(options.debug)
                if (api != null) builder.integration(api)
                options.integrations.forEach { builder.integration(it) }
                val facade = builder.build()
                val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "iforevents").apply { isDaemon = true } }
                val created = IforeventsAndroid(facade, api, executor)
                created.submit { facade.init() }
                if (app is Application && (options.trackActivities || options.flushOnBackground || options.trackDeepLinks)) {
                    app.registerActivityLifecycleCallbacks(Lifecycle(created, options.trackActivities, options.flushOnBackground, options.trackDeepLinks))
                }
                shared = created
                return created
            }
        }

        // Shortcuts so Kotlin can write IforeventsAndroid.track(...) after init.
        // Not @JvmStatic: a static with the same signature as the instance
        // method is a JVM declaration clash. Java calls getInstance().track(...).
        @JvmOverloads fun identify(customId: String, traits: Map<String, Any?> = emptyMap()) = instance.identify(customId, traits)
        @JvmOverloads fun track(name: String, properties: Map<String, Any?> = emptyMap()) = instance.track(name, properties)
        @JvmOverloads fun screen(name: String, properties: Map<String, Any?> = emptyMap()) = instance.screen(name, properties)
        @JvmOverloads fun trackDeepLink(url: String, referrer: String? = null) = instance.trackDeepLink(url, referrer)
        fun reset() = instance.reset()
        fun flush() = instance.flush()

        /** Test hook: forget the shared instance. */
        @JvmStatic
        fun resetForTests() {
            shared?.shutdown(1_000)
            shared = null
        }
    }

    /** Screen views from resumed activities; a flush when the last one stops. */
    private class Lifecycle(
        private val sdk: IforeventsAndroid,
        private val trackActivities: Boolean,
        private val flushOnBackground: Boolean,
        private val trackDeepLinks: Boolean,
    ) : Application.ActivityLifecycleCallbacks {
        private var started = 0
        private var previous: String? = null

        override fun onActivityResumed(activity: Activity) {
            if (trackDeepLinks) recordDeepLink(activity)
            if (!trackActivities) return
            val name = activity.javaClass.simpleName
            sdk.screen(name, emptyMap(), if (previous == null) "load" else "resume", previous)
            previous = name
        }

        override fun onActivityStarted(activity: Activity) {
            started++
        }

        override fun onActivityStopped(activity: Activity) {
            started--
            if (started <= 0 && flushOnBackground) sdk.flush()
        }

        /** The Intent's deep link, once per Intent (a marker extra is left on it). */
        private fun recordDeepLink(activity: Activity) {
            val intent: Intent = activity.intent ?: return
            val data = intent.dataString ?: return
            if (intent.getBooleanExtra(HANDLED_EXTRA, false)) return
            intent.putExtra(HANDLED_EXTRA, true)
            val referrer = if (android.os.Build.VERSION.SDK_INT >= 22) activity.referrer?.toString() else null
            sdk.trackDeepLink(data, referrer)
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityPaused(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }
}
