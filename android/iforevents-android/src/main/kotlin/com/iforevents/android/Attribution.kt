package com.iforevents.android

import java.net.URI
import java.net.URLDecoder

/**
 * Session attribution (sdks/CONTRACT.md, "Attribution"): the utm
 * parameters, ad click ids and external referring domain a session arrived
 * with, attached as event properties to every event of that session so the
 * IForevents api can split any report by origin ($channel, $source,
 * $utm_campaign, ...).
 */
object Attribution {
    /** The utm parameters, attached under their own names. */
    @JvmField
    val UTM_KEYS: List<String> = listOf("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id")

    /** Ad platform click ids, attached under their own names. */
    @JvmField
    val CLICK_ID_KEYS: List<String> = listOf("gclid", "gbraid", "wbraid", "dclid", "msclkid", "fbclid", "ttclid", "twclid", "li_fat_id", "epik", "sccid", "rdt_cid", "yclid")

    /** A session ends after this long without an event. */
    const val SESSION_MILLIS: Long = 30 * 60 * 1000L

    private const val MAX_VALUE = 512

    /**
     * The attribution of a landing: the utm and click id parameters of [url]
     * (a deep link such as `myapp://promo?utm_source=x`, or an App Link) plus
     * `referring_domain` when [referrer] (the Activity's referrer) is another
     * host. Empty for a landing that carries none.
     */
    @JvmStatic
    @JvmOverloads
    fun fromUrl(url: String, referrer: String? = null): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        val query = url.substringAfter('?', "").substringBefore('#')
        val params = parseQuery(query)
        for (key in UTM_KEYS + CLICK_ID_KEYS) {
            val value = params[key]?.trim()
            if (!value.isNullOrEmpty()) out[key] = value.take(MAX_VALUE)
        }
        val refHost = host(referrer)
        if (refHost.isNotEmpty() && refHost != host(url)) out["referring_domain"] = refHost
        return out
    }

    /**
     * The attribution of the Play install referrer string
     * (`utm_source=google-play&utm_medium=organic`), from the Install
     * Referrer library's `ReferrerDetails.installReferrer`.
     */
    @JvmStatic
    fun fromInstallReferrer(referrer: String): Map<String, String> = fromUrl("x://x?" + referrer.removePrefix("?"))

    private fun parseQuery(query: String): Map<String, String> {
        if (query.isEmpty()) return emptyMap()
        val out = HashMap<String, String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val name = decode(pair.substringBefore('='))
            if (name !in out) out[name] = decode(pair.substringAfter('=', ""))
        }
        return out
    }

    private fun decode(s: String): String = try {
        URLDecoder.decode(s, "UTF-8")
    } catch (e: Exception) {
        s
    }

    private fun host(url: String?): String {
        if (url.isNullOrEmpty()) return ""
        val h = try {
            URI(url).host
        } catch (e: Exception) {
            null
        } ?: return ""
        return h.lowercase().removePrefix("www.")
    }
}

/**
 * The current session's attribution. A landing that carries attribution
 * starts a new one; otherwise it lasts while events keep coming within
 * [Attribution.SESSION_MILLIS], and is dropped after.
 */
class AttributionTracker(private val clock: () -> Long = System::currentTimeMillis) {
    private var props: Map<String, String> = emptyMap()
    private var lastSeen: Long? = null

    /** The current attribution, empty for a direct session. */
    val current: Map<String, String> get() = props

    fun touch(landing: Map<String, String> = emptyMap()) {
        val now = clock()
        val last = lastSeen
        if (landing.isNotEmpty()) {
            props = HashMap(landing)
        } else if (last == null || now - last > Attribution.SESSION_MILLIS) {
            props = emptyMap()
        }
        lastSeen = now
    }

    /** [properties] with the attribution added; the caller's own keys win. */
    fun apply(properties: Map<String, Any?>, landing: Map<String, String> = emptyMap()): Map<String, Any?> {
        touch(landing)
        if (props.isEmpty()) return properties
        return LinkedHashMap<String, Any?>(props).apply { putAll(properties) }
    }

    fun clear() {
        props = emptyMap()
        lastSeen = null
    }
}
