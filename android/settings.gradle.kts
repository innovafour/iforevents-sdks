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
        mavenLocal() // com.iforevents:iforevents from ../iforevents-java during local development
    }
}
rootProject.name = "iforevents-android"
include(":iforevents-android", ":iforevents-android-firebase", ":iforevents-android-mixpanel")
