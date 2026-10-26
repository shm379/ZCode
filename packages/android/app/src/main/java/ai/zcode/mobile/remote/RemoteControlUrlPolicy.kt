package ai.zcode.mobile.remote

import android.net.Uri
import ai.zcode.mobile.BuildConfig

/**
 * 远控 URL 白名单入口。纯判定逻辑在 [RemoteControlUrlRules]（JVM 可测），
 * 这里只负责把 Android 侧输入（android.net.Uri、BuildConfig）接进去。
 *
 * directServerOrigins 是用户保存的直连 zcode-server origin 集合，由调用方
 * 从 [DirectServerStore] 读取后传入；判定本身不读存储，保持无副作用。
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
