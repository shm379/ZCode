package ai.zcode.mobile.remote

import java.net.URI

/**
 * 纯 JVM 的远控 URL 判定规则，不依赖 android.net.Uri / BuildConfig，
 * 因此可以在本地单元测试里同时覆盖 debug 与 release 行为。
 *
 * 三类放行来源（按优先级）：
 * 1. 官方 relay：https://zcode.z.ai/remote*；
 * 2. 用户保存的直连 zcode-server：origin 完全一致 + 根路径 + 仅 token 查询参数；
 * 3. debug 构建额外放开测试域与本机/局域网 /remote 页面（真机调试 Vite 用）。
 * 除此之外一律不放行，远控壳不能退化成任意浏览器。
 */
data class RemoteControlUrlPolicyConfig(
    val debug: Boolean,
    val directServerOrigins: Set<String> = emptySet(),
)

object RemoteControlUrlRules {
    const val DIRECT_SERVER_ALLOWED_QUERY_KEY = "token"

    fun resolve(
        raw: String?,
        config: RemoteControlUrlPolicyConfig,
        defaultRemoteUrl: String,
    ): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            return null
        }
        val uri = parse(trimmed) ?: return null

        if (isDeepLink(uri)) {
            return rewriteDefaultRemoteUrl(uri, defaultRemoteUrl)
        }
        return if (isAllowed(uri, config)) trimmed else null
    }

    fun isAllowed(raw: String?, config: RemoteControlUrlPolicyConfig): Boolean {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            return false
        }
        val uri = parse(trimmed) ?: return false
        return isAllowed(uri, config)
    }

    private fun isAllowed(uri: URI, config: RemoteControlUrlPolicyConfig): Boolean {
        val scheme = uri.scheme?.lowercase().orEmpty()
        val host = uri.host?.lowercase()
        if (host.isNullOrEmpty()) {
            return false
        }

        if (scheme == "https" && host == "zcode.z.ai" && (uri.rawPath.orEmpty()).startsWith("/remote")) {
            return true
        }

        if (scheme == "http" || scheme == "https") {
            val origin = normalizeOrigin(scheme, host, uri.port)
            if (
                config.directServerOrigins.contains(origin) &&
                isRootPath(uri.rawPath) &&
                hasOnlyDirectServerQuery(uri.rawQuery)
            ) {
                return true
            }
        }

        if (!config.debug) {
            return false
        }

        // debug 包放开测试域/局域网的 /remote 页面；生产包仍只认 zcode.z.ai 与已保存直连服务器。
        val path = uri.rawPath.orEmpty()
        if (!path.startsWith("/remote")) {
            return false
        }
        if (host == "zcode.z.ai") {
            return scheme == "https"
        }
        return (scheme == "http" || scheme == "https") && isDebugHost(host)
    }

    fun normalizeOrigin(scheme: String, host: String, port: Int): String {
        val defaultPort = if (scheme == "https") 443 else 80
        val effectivePort = if (port > 0) port else defaultPort
        // IPv6 host 需要重新加上方括号，否则 origin 字符串不合法。
        val hostPart = if (host.contains(':')) "[$host]" else host
        return if (effectivePort == defaultPort) {
            "$scheme://$hostPart"
        } else {
            "$scheme://$hostPart:$effectivePort"
        }
    }

    private fun parse(raw: String): URI? = runCatching { URI(raw) }.getOrNull()

    private fun isDeepLink(uri: URI): Boolean = uri.scheme == "zcode" && uri.host == "remote"

    // 深链把 query/fragment 平移到默认远控地址，沿用 raw 部件避免二次编码，
    // 与旧实现（encodedQuery/encodedFragment 平移）行为一致。
    private fun rewriteDefaultRemoteUrl(deepLink: URI, defaultRemoteUrl: String): String {
        val base = parse(defaultRemoteUrl) ?: return defaultRemoteUrl
        val builder = StringBuilder()
            .append(base.scheme).append("://").append(base.rawAuthority)
        if (!base.rawPath.isNullOrEmpty()) {
            builder.append(base.rawPath)
        }
        deepLink.rawQuery?.let { builder.append('?').append(it) }
        deepLink.rawFragment?.let { builder.append('#').append(it) }
        return builder.toString()
    }

    private fun isRootPath(rawPath: String?): Boolean =
        rawPath.isNullOrEmpty() || rawPath == "/"

    // 直连服务器仅允许 token 查询参数（服务端用它引导 HttpOnly cookie）。
    // 其它查询键说明这不是壳自己拼出的连接地址，直接拒绝而不是猜意图。
    private fun hasOnlyDirectServerQuery(rawQuery: String?): Boolean {
        if (rawQuery.isNullOrEmpty()) {
            return true
        }
        return rawQuery.split('&').all { part ->
            part.substringBefore('=') == DIRECT_SERVER_ALLOWED_QUERY_KEY
        }
    }

    private fun isDebugHost(host: String): Boolean {
        if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") {
            return true
        }
        if (host.endsWith(".local")) {
            return true
        }
        if (host.startsWith("192.168.") || host.startsWith("10.")) {
            return true
        }
        return Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.").containsMatchIn(host)
    }
}
