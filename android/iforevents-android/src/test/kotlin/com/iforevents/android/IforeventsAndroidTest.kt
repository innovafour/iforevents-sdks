package com.iforevents.android

import androidx.test.core.app.ApplicationProvider
import com.iforevents.BaseIntegration
import com.iforevents.IdentifyEvent
import com.iforevents.TrackEvent
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class IforeventsAndroidTest {
    private val received = mutableListOf<Pair<String, Map<String, String>>>()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { ex ->
            val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
            synchronized(received) { received.add(ex.requestURI.path to mapOf("body" to body, "user" to (ex.requestHeaders.getFirst("X-User-Id") ?: ""))) }
            val out = """{"status":"ok","user":{"uuid":"1"}}""".toByteArray()
            ex.sendResponseHeaders(201, out.size.toLong())
            ex.responseBody.use { it.write(out) }
        }
        start()
    }

    @After
    fun tearDown() {
        IforeventsAndroid.resetForTests()
        server.stop(0)
    }

    @Test
    fun deliversOffMainThreadWithDeviceContextAndPersistedUserId() {
        val threads = mutableSetOf<String>()
        val probe = object : BaseIntegration("Probe", null) {
            override fun identify(event: IdentifyEvent) { threads.add(Thread.currentThread().name) }
            override fun track(event: TrackEvent) { threads.add(Thread.currentThread().name) }
        }
        val sdk = IforeventsAndroid.init(ApplicationProvider.getApplicationContext(), "pk_test") {
            integration(probe)
            configure = { baseUrl("http://127.0.0.1:${server.address.port}"); batchSize(1) }
        }
        sdk.identify("droid_user", mapOf("plan" to "pro")).get(5, TimeUnit.SECONDS)
        sdk.track("opened", mapOf("n" to 1)).get(5, TimeUnit.SECONDS)
        assertEquals(setOf("iforevents"), threads)
        val identify = received.first { it.first == "/v1/events/identify" }.second
        assertTrue(identify["body"]!!.contains("\"device_platform\":\"android\""))
        assertEquals("droid_user", identify["user"])
        val track = received.first { it.first == "/v1/events/track" }.second
        assertEquals("droid_user", track["user"])
        assertTrue(track["body"]!!.contains("\"plan\":\"pro\""))
        assertEquals("droid_user", AndroidStorage(ApplicationProvider.getApplicationContext()).get("iforevents_user_id"))
    }

    @Test
    fun anonymousIdIsGeneratedAndPersisted() {
        val sdk = IforeventsAndroid.init(ApplicationProvider.getApplicationContext(), "pk_test") {
            configure = { baseUrl("http://127.0.0.1:${server.address.port}"); batchSize(1) }
        }
        sdk.track("first").get(5, TimeUnit.SECONDS)
        val user = received.first { it.first == "/v1/events/track" }.second["user"]!!
        assertTrue(user, Regex("^anon_[0-9a-f]{32}$").matches(user))
        assertEquals(user, AndroidStorage(ApplicationProvider.getApplicationContext()).get("iforevents_user_id"))
    }
}
