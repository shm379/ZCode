package ai.zcode.mobile.remote

import android.net.Uri
import ai.zcode.mobile.BuildConfig

/**
 * Allowlist entrypoint for remote-control URLs. The pure decision logic lives in
 * [RemoteControlUrlRules] (JVM-testable); this only wires in the Android-side inputs
 * (android.net.Uri, BuildConfig).
 *
 * directServerOrigins is the set of user-saved direct-connect zcode-server origins,
 * read from [DirectServerStore] by the caller; the decision itself never touches
 * storage and stays side-effect free.
 */
object RemoteControlUrlPolicy {
    fun resolve(raw: String?, directServerOrigins: Set<String> = emptySet()): String? =
        RemoteControlUrlRules.resolve(
            raw = raw,
            config = config(directServerOrigins),
            defaultRemoteUrl = BuildConfig.REMOTE_CONTROL_DEFAULT_URL,
        )

    fun resolve(uri: Uri?, directServerOrigins: Set<String> = emptySet()): String? =
        resolve(uri?.toString(), directServerOrigins)

    fun isAllowedRemoteUrl(raw: String?, directServerOrigins: Set<String> = emptySet()): Boolean =
        resolve(raw, directServerOrigins) != null

    private fun config(directServerOrigins: Set<String>) = RemoteControlUrlPolicyConfig(
        debug = BuildConfig.DEBUG,
        directServerOrigins = directServerOrigins,
    )
}
