package ai.zcode.mobile.remote

import java.net.URI
import java.net.URLDecoder

/**
 * 扫码直连草稿：从二维码原始文本解析「自托管 zcode-server 直连地址 + 可选令牌」。
 * 纯 JVM 实现，不依赖 android 类，可在本地单元测试直接覆盖。
 *
 * 定位：扫描内容先走 [RemoteControlUrlRules.resolve]（relay / deep link / 已保存直连），
 * 只有 resolve 失败后才尝试 [fromUrl]。因此这里与导航白名单保持同一判定边界：仅接受
 * http/https、根路径、查询只含 token 的地址；relay 域名与 deep link 一律返回 null
 * （它们各自的原有路径不变），不引入第二条放行路径。
 */
data class DirectServerDraft(
    /** 归一化 origin（scheme://host[:port]），可直接作为 DirectServerStore.save 的地址。 */
    val address: String,
    /** 确认弹窗展示用 host[:port]（与 origin 一致，仅去掉 scheme 前缀）。 */
    val label: String,
    /** ?token= 解码后的令牌；无 token 查询或值为空时为 null。 */
    val token: String?,
) {
    companion object {
        // 与 RemoteControlUrlRules 的 relay 域名一致；规则文件不改，这里单独声明。
        private const val RELAY_HOST = "zcode.z.ai"

        fun fromUrl(raw: String?): DirectServerDraft? {
            val trimmed = raw?.trim().orEmpty()
            if (trimmed.isEmpty()) {
                return null
            }
            val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase().orEmpty()
            if (scheme != "http" && scheme != "https") {
                return null
            }
            val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
            // relay 域名属于官方远控入口，永远走原 resolve 流程，不当作自托管服务器保存。
            if (host == RELAY_HOST) {
                return null
            }
            val path = uri.rawPath.orEmpty()
            if (path.isNotEmpty() && path != "/") {
                return null
            }
            // Bugfix: 空 token（?token=）是合法输入（与白名单规则一致），只是令牌记为 null；
            // 因此「无查询/空值」与「查询非法」必须分开：extractToken 仅用 null 表示非法，
            // 空值在此处统一折叠为 null 令牌，避免合法的 ?token= 被整条草稿作废。
            val token: String?
            if (uri.rawQuery.isNullOrEmpty()) {
                token = null
            } else {
                val rawToken = extractToken(uri.rawQuery) ?: return null
                token = rawToken.takeIf { it.isNotBlank() }
            }
            val origin = RemoteControlUrlRules.normalizeOrigin(scheme, host, uri.port)
            return DirectServerDraft(
                address = origin,
                label = origin.removePrefix("$scheme://"),
                token = token,
            )
        }

        /**
         * 与 RemoteControlUrlRules 的直连查询规则一致：查询键只允许 token，其余键说明
         * 这不是壳自己拼出的连接地址。取第一个 token 值并按 query 规则解码（URLDecoder
         * 与 DirectServerStore.buildConnectUrl 的 URLEncoder 互逆）。
         * 返回 null 仅表示查询非法或解码失败；token 值为空时返回空串（合法），由调用方折叠。
         */
        private fun extractToken(rawQuery: String): String? {
            var token: String? = null
            for (part in rawQuery.split('&')) {
                if (part.substringBefore('=') != RemoteControlUrlRules.DIRECT_SERVER_ALLOWED_QUERY_KEY) {
                    return null
                }
                if (token == null) {
                    val value = if ('=' in part) part.substringAfter('=') else ""
                    token = runCatching { URLDecoder.decode(value, Charsets.UTF_8.name()) }
                        .getOrNull()
                        ?: return null
                }
            }
            return token
        }
    }
}
