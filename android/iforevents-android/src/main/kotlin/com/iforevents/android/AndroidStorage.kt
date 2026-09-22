package com.iforevents.android

import android.content.Context
import android.content.SharedPreferences
import com.iforevents.Storage

/** [Storage] on SharedPreferences: the user id and the pending queue survive restarts. */
class AndroidStorage(context: Context, name: String = "iforevents") : Storage {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }
}
