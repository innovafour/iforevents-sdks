plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "com.iforevents.android.mixpanel"
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
    api(libs.mixpanel.android)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}

mavenPublishing {
    coordinates("com.iforevents", "iforevents-android-mixpanel", version.toString())
    pom {
        name.set("iforevents-android-mixpanel")
        description.set("Mixpanel adapter for the IForevents Android SDK")
        url.set("https://github.com/innovafour/iforevents-sdks/tree/main/android")
        licenses { license { name.set("MIT"); url.set("https://opensource.org/licenses/MIT") } }
        developers { developer { name.set("Innovafour") } }
        scm { url.set("https://github.com/innovafour/iforevents-sdks/tree/main/android") }
    }
}
