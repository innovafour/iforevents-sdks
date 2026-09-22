package com.iforevents.android

import androidx.test.core.app.ApplicationProvider
import com.iforevents.BaseIntegration
import com.iforevents.IdentifyEvent
import com.iforevents.TrackEvent
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
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

    // android.jar has no com.sun.net.httpserver, so the fake api is a
    // ServerSocket that reads one request per connection and answers 201.
    private val server = FakeApi(received).apply { start() }

    private class FakeApi(private val received: MutableList<Pair<String, Map<String, String>>>) : Thread("fake-api") {
        private val socket = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
        val port: Int get() = socket.localPort

        init { isDaemon = true }

        override fun run() {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (e: Exception) { return }
                try { handle(client) } catch (e: Exception) { /* client went away */ } finally { client.close() }
            }
        }

        private fun handle(client: Socket) {
            val input = client.getInputStream().buffered()
            val requestLine = readLine(input) ?: return
            val path = requestLine.split(" ")[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val bytes = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(bytes, read, length - read)
                if (n < 0) break
                read += n
            }
            val body = String(bytes, 0, read, Charsets.UTF_8)
            synchronized(received) { received.add(path to mapOf("body" to body, "user" to (headers["x-user-id"] ?: ""))) }
            val out = """{"status":"ok","user":{"uuid":"1"}}""".toByteArray()
            val response = "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: ${out.size}\r\nConnection: close\r\n\r\n"
            client.getOutputStream().apply {
                write(response.toByteArray())
                write(out)
                flush()
            }
        }

        private fun readLine(input: java.io.InputStream): String? {
            val sb = StringBuilder()
            while (true) {
                val c = input.read()
                if (c < 0) return if (sb.isEmpty()) null else sb.toString()
                if (c == '\n'.code) return sb.toString().trimEnd('\r')
                sb.append(c.toChar())
            }
        }

        fun shutdown() { socket.close() }
    }

    @After
    fun tearDown() {
        IforeventsAndroid.resetForTests()
        server.shutdown()
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
            configure = { baseUrl("http://127.0.0.1:${server.port}"); batchSize(1) }
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
            configure = { baseUrl("http://127.0.0.1:${server.port}"); batchSize(1) }
        }
        sdk.track("first").get(5, TimeUnit.SECONDS)
        val user = received.first { it.first == "/v1/events/track" }.second["user"]!!
        assertTrue(user, Regex("^anon_[0-9a-f]{32}$").matches(user))
        assertEquals(user, AndroidStorage(ApplicationProvider.getApplicationContext()).get("iforevents_user_id"))
    }
}
