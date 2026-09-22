package com.iforevents.android.firebase

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics
import com.iforevents.BaseIntegration
import com.iforevents.Hooks
import com.iforevents.IdentifyEvent
import com.iforevents.PageEvent
import com.iforevents.TrackEvent

/**
 * Forwards calls to Firebase Analytics. Needs the app's google-services
 * configuration; mirrors `iforevents_firebase`. Event and parameter names are
 * normalized to Firebase's rules (letters, digits, underscores; 40 chars).
 */
class FirebaseIntegration(private val analytics: FirebaseAnalytics, hooks: Hooks? = null) : BaseIntegration("FirebaseIntegration", hooks) {
    constructor(context: Context, hooks: Hooks? = null) : this(FirebaseAnalytics.getInstance(context.applicationContext), hooks)

    override fun identify(event: IdentifyEvent) {
        super.identify(event)
        analytics.setUserId(event.customId)
        for ((k, v) in event.traits) {
            if (v == null) continue
            analytics.setUserProperty(sanitize(k, 24), v.toString().take(36))
        }
    }

    override fun track(event: TrackEvent) {
        super.track(event)
        analytics.logEvent(sanitize(event.name, 40), bundle(event.properties))
    }

    override fun page(event: PageEvent) {
        super.page(event)
        val params = bundle(event.properties).apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, event.name)
            event.navigationType?.let { putString("navigation_type", it) }
            event.previousRoute?.let { putString("previous_route", it) }
        }
        analytics.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params)
    }

    override fun reset() {
        super.reset()
        analytics.setUserId(null)
        analytics.resetAnalyticsData()
    }

    private fun bundle(properties: Map<String, Any?>): Bundle = Bundle().apply {
        for ((k, v) in properties) {
            val key = sanitize(k, 40)
            when (v) {
                null -> {}
                is Int -> putLong(key, v.toLong())
                is Long -> putLong(key, v)
                is Float -> putDouble(key, v.toDouble())
                is Double -> putDouble(key, v)
                is Boolean -> putString(key, v.toString())
                else -> putString(key, v.toString().take(100))
            }
        }
    }

    private fun sanitize(name: String, max: Int): String {
        val cleaned = name.replace(Regex("[^A-Za-z0-9_]"), "_").trim('_')
        val safe = if (cleaned.isEmpty() || !cleaned.first().isLetter()) "e_$cleaned" else cleaned
        return safe.take(max)
    }
}
