package com.iforevents.android.mixpanel

import android.content.Context
import com.iforevents.BaseIntegration
import com.iforevents.Hooks
import com.iforevents.IdentifyEvent
import com.iforevents.PageEvent
import com.iforevents.TrackEvent
import com.mixpanel.android.mpmetrics.MixpanelAPI
import org.json.JSONObject

/** Forwards calls to the Mixpanel Android SDK. Mirrors `iforevents_mixpanel`. */
class MixpanelIntegration(private val mixpanel: MixpanelAPI, hooks: Hooks? = null) : BaseIntegration("MixpanelIntegration", hooks) {
    constructor(context: Context, token: String, hooks: Hooks? = null) : this(MixpanelAPI.getInstance(context.applicationContext, token, false), hooks)

    override fun identify(event: IdentifyEvent) {
        super.identify(event)
        mixpanel.identify(event.customId)
        mixpanel.people.set(JSONObject(event.traits.filterValues { it != null }))
    }

    override fun track(event: TrackEvent) {
        super.track(event)
        mixpanel.track(event.name, JSONObject(event.properties.filterValues { it != null }))
    }

    override fun page(event: PageEvent) {
        super.page(event)
        val props = event.properties.filterValues { it != null }.toMutableMap()
        event.navigationType?.let { props["navigation_type"] = it }
        event.toRoute?.let { props["to_route"] = it }
        event.previousRoute?.let { props["previous_route"] = it }
        mixpanel.track(event.name, JSONObject(props as Map<*, *>))
    }

    override fun reset() {
        super.reset()
        mixpanel.flush()
        mixpanel.reset()
    }

    override fun flush() {
        mixpanel.flush()
    }
}
