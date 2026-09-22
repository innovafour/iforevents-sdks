# IForevents SDK for Android

Kotlin-first (Java friendly) analytics SDK built on the JVM core
`com.iforevents:iforevents`: device context, a SharedPreferences queue that
survives restarts, delivery on a background thread, screen views from the
activity lifecycle, a flush when the app goes to the background, and adapters
for Firebase Analytics and Mixpanel. Same philosophy as the Flutter package.

```kotlin
// build.gradle.kts
implementation("com.iforevents:iforevents-android:0.1.0")
implementation("com.iforevents:iforevents-android-firebase:0.1.0") // optional
implementation("com.iforevents:iforevents-android-mixpanel:0.1.0") // optional
```

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        IforeventsAndroid.init(this, "pk_...") {
            integration(FirebaseIntegration(this@App))
            integration(MixpanelIntegration(this@App, "MIXPANEL_TOKEN"))
            configure = { batchSize(20) } // any APIConfig.Builder option
        }
    }
}

IforeventsAndroid.identify("user_123", mapOf("email" to "ada@example.com", "plan" to "pro"))
IforeventsAndroid.track("purchase_completed", mapOf("total" to 9.99))
IforeventsAndroid.reset() // logout
```

> The project key is a public write key: it grants event ingestion and
> nothing else, so shipping it in the APK is safe. There is no project secret.

Every call runs on the SDK's worker thread and returns a `Future` you may
ignore. Identity: a generated `anon_...` id per install until `identify`,
then your id; `reset()` starts a fresh anonymous id.

## Development

Needs the Android SDK (`ANDROID_HOME`) and JDK 17. The core is resolved from
Maven Central, or from `~/.m2` after `mvn install` in `../iforevents-java`.

```bash
gradle test   # Gradle 8.9+; no wrapper is committed
```

MIT
