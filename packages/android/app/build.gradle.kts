import java.io.File
import java.util.Properties

private data class ReleaseSigningConfig(
    val storeFile: File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

// Prefer packages/android/keystore.properties, then ~/.gradle/zcode-android-release.properties;
// when neither exists or fields are incomplete, return null so release degrades to an
// unsigned artifact instead of failing the build.
// The keystore and any properties file containing passwords must never be committed
// (see .gitignore and docs/mobile-remote-control-android.md).
private fun loadReleaseSigningConfig(): ReleaseSigningConfig? {
    val candidates = listOf(
        rootProject.file("keystore.properties"),
        File(System.getProperty("user.home"), ".gradle/zcode-android-release.properties"),
    )
    val props = candidates.firstOrNull { it.isFile }?.let { file ->
        Properties().apply { file.inputStream().use { load(it) } }
    } ?: return null

    val storePath = props.getProperty("ZCODE_ANDROID_STORE_FILE") ?: return null
    val storeFile = if (File(storePath).isAbsolute) File(storePath) else rootProject.file(storePath)
    val storePassword = props.getProperty("ZCODE_ANDROID_STORE_PASSWORD") ?: return null
    val keyAlias = props.getProperty("ZCODE_ANDROID_KEY_ALIAS") ?: return null
    val keyPassword = props.getProperty("ZCODE_ANDROID_KEY_PASSWORD") ?: return null
    if (!storeFile.isFile) {
        logger.warn("File pointed to by ZCODE_ANDROID_STORE_FILE does not exist: ${storeFile.path}; release will be unsigned.")
        return null
    }
    return ReleaseSigningConfig(storeFile, storePassword, keyAlias, keyPassword)
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.zcode.mobile"
    buildToolsVersion = "36.1.0"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "ai.zcode.mobile"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        buildConfigField("String", "REMOTE_CONTROL_DEFAULT_URL", "\"https://zcode.z.ai/remote\"")
    }

    val releaseSigning = loadReleaseSigningConfig()

    signingConfigs {
        releaseSigning?.let { signing ->
            create("release") {
                storeFile = signing.storeFile
                storePassword = signing.storePassword
                keyAlias = signing.keyAlias
                keyPassword = signing.keyPassword
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            buildConfigField("String", "REMOTE_CONTROL_DEFAULT_URL", "\"https://zcode.z.ai/remote\"")
        }
        release {
            // Direct self-hosted zcode-server connections need http (LAN); the navigation
            // security boundary lives in RemoteControlUrlPolicy.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            releaseSigning?.let { signingConfig = signingConfigs.getByName("release") }
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
