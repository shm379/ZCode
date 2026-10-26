package ai.zcode.mobile.remote

import java.net.URI

/**
 * Pure-JVM remote-control URL decision rules, with no dependency on android.net.Uri /
 * BuildConfig, so local unit tests can cover both debug and release behavior.
 *
 * Three accepted source classes (by priority):
 * 1. Official relay: https://zcode.z.ai/remote*;
 * 2. User-saved direct-connect zcode-server: exact origin match + root path +
 *    token-only query parameter;
 * 3. Debug builds additionally allow test domains and local/LAN /remote pages
 *    (for debugging against Vite on a real device).
 * Anything else is rejected; the remote-control shell must never degrade into a
 * general-purpose browser.
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

        // Debug builds open /remote pages on test domains/LAN; release builds still only
        // accept zcode.z.ai and saved direct servers.
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
        // IPv6 hosts need the square brackets re-added, otherwise the origin string is invalid.
        val hostPart = if (host.contains(':')) "[$host]" else host
        return if (effectivePort == defaultPort) {
            "$scheme://$hostPart"
        } else {
            "$scheme://$hostPart:$effectivePort"
        }
    }

    private fun parse(raw: String): URI? = runCatching { URI(raw) }.getOrNull()

    private fun isDeepLink(uri: URI): Boolean = uri.scheme == "zcode" && uri.host == "remote"

    // The deep link moves query/fragment onto the default remote-control URL, reusing the
    // raw parts to avoid double encoding, matching the old implementation's behavior
    // (encodedQuery/encodedFragment passthrough).
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

    // Direct servers only allow the token query parameter (the server uses it to seed
    // the HttpOnly cookie). Any other query key means the URL was not assembled by the
    // shell itself; reject it outright instead of guessing intent.
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
