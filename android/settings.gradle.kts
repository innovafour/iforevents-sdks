pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        mavenLocal() // com.iforevents:iforevents from ../java during local development
    }
}
rootProject.name = "iforevents-android"
include(":iforevents-android", ":iforevents-android-firebase", ":iforevents-android-mixpanel")
