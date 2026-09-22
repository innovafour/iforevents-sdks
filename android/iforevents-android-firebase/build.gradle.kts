plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "com.iforevents.android.firebase"
    compileSdk = 35
    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    api(project(":iforevents-android"))
    api(libs.firebase.analytics)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}

mavenPublishing {
    coordinates("com.iforevents", "iforevents-android-firebase", version.toString())
    pom {
        name.set("iforevents-android-firebase")
        description.set("Firebase Analytics adapter for the IForevents Android SDK")
        url.set("https://github.com/innovafour/iforevents-sdks/tree/main/android")
        licenses { license { name.set("MIT"); url.set("https://opensource.org/licenses/MIT") } }
        developers { developer { name.set("Innovafour") } }
        scm { url.set("https://github.com/innovafour/iforevents-sdks/tree/main/android") }
    }
}
