package com.iforevents.android

import org.junit.Assert.assertEquals
import org.junit.Test

class AttributionTest {
    @Test fun deepLink() {
        assertEquals(mapOf("utm_source" to "tiktok", "utm_campaign" to "launch day", "ttclid" to "t1"), Attribution.fromUrl("myapp://promo?utm_source=tiktok&utm_campaign=launch%20day&ttclid=t1&x=1"))
        assertEquals(emptyMap<String, String>(), Attribution.fromUrl("myapp://home"))
    }
    @Test fun referrer() {
        assertEquals(mapOf("referring_domain" to "com.google.android.gm"), Attribution.fromUrl("https://shop.example/p", "android-app://com.google.android.gm"))
        assertEquals(emptyMap<String, String>(), Attribution.fromUrl("https://www.shop.example/p", "https://shop.example/"))
    }
    @Test fun installReferrer() {
        assertEquals(mapOf("utm_source" to "google-play", "utm_medium" to "organic"), Attribution.fromInstallReferrer("utm_source=google-play&utm_medium=organic"))
    }
    @Test fun session() {
        var now = 0L
        val t = AttributionTracker { now }
        assertEquals(mapOf("utm_source" to "x", "a" to 1), t.apply(mapOf("a" to 1), mapOf("utm_source" to "x")))
        now += Attribution.SESSION_MILLIS
        assertEquals(mapOf("utm_source" to "mine"), t.apply(mapOf("utm_source" to "mine")))
        now += Attribution.SESSION_MILLIS + 1
        assertEquals(emptyMap<String, Any?>(), t.apply(emptyMap()))
    }
}
