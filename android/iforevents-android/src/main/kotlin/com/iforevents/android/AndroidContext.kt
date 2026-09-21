package com.iforevents.android

import android.content.Context
import android.os.Build
import java.util.Locale
import java.util.TimeZone

/** Device context merged into identify traits, with the Flutter key names. */
object AndroidContext {
    const val SDK_NAME = "iforevents-android"
    const val SDK_VERSION = "0.1.0"

    @JvmStatic
    fun collect(context: Context, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> {
        val app = context.applicationContext
        val (versionName, versionCode) = try {
            val info = app.packageManager.getPackageInfo(app.packageName, 0)
            @Suppress("DEPRECATION")
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
            (info.versionName ?: "") to code
        } catch (_: Exception) {
            "" to 0L
        }
        val ctx = linkedMapOf<String, Any?>(
            "sdk_name" to SDK_NAME,
            "sdk_version" to SDK_VERSION,
            "runtime" to "android/${Build.VERSION.SDK_INT}",
            "device_platform" to "android",
            "device_brand" to Build.BRAND,
            "device_model" to Build.MODEL,
            "device_os_version" to Build.VERSION.RELEASE,
            "device_app_version" to versionName,
            "app_build" to versionCode,
            "app_package" to app.packageName,
            "manufacturer" to Build.MANUFACTURER,
            "device" to Build.DEVICE,
            "sdk_int" to Build.VERSION.SDK_INT,
            "language" to Locale.getDefault().toLanguageTag(),
            "timezone" to TimeZone.getDefault().id,
        )
        ctx.putAll(extra)
        return ctx
    }
}
