package ai.zcode.mobile.remote

import java.net.URI
import java.net.URLDecoder

/**
 * QR-scan direct-connect draft: parses "self-hosted zcode-server direct address +
 * optional token" from the raw QR text.
 * Pure JVM implementation with no android dependency, so local unit tests can cover
 * it directly.
 *
 * Positioning: scanned content first goes through [RemoteControlUrlRules.resolve]
 * (relay / deep link / saved direct); only when resolve fails do we try [fromUrl].
 * This keeps the same acceptance boundary as the navigation allowlist: only accept
 * http/https, root path, and a query containing only token; relay hosts and deep
 * links always return null (their original paths stay unchanged), so no second
 * acceptance path is introduced.
 */
data class DirectServerDraft(
    /** Normalized origin (scheme://host[:port]), usable directly as the address for DirectServerStore.save. */
    val address: String,
    /** host[:port] shown in the confirmation dialog (same as origin, only the scheme prefix removed). */
    val label: String,
    /** Token decoded from ?token=; null when there is no token query or the value is empty. */
    val token: String?,
) {
    companion object {
        // Same relay host as RemoteControlUrlRules; the rules file stays untouched,
        // so it is declared separately here.
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
            // The relay host is the official remote-control entry; it always goes through
            // the original resolve flow and is never saved as a self-hosted server.
            if (host == RELAY_HOST) {
                return null
            }
            val path = uri.rawPath.orEmpty()
            if (path.isNotEmpty() && path != "/") {
                return null
            }
            // Bugfix: an empty token (?token=) is valid input (consistent with the allowlist
            // rules); only the token is recorded as null. So "no query / empty value" must be
            // distinguished from "invalid query": extractToken uses null only for invalid,
            // and an empty value is folded into a null token here, so a valid ?token= is not
            // rejected together with the whole draft.
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
         * Consistent with RemoteControlUrlRules' direct-connect query rules: the only
         * allowed query key is token; any other key means this URL was not assembled
         * by the shell itself. Takes the first token value and decodes it per the query
         * rules (URLDecoder is the inverse of DirectServerStore.buildConnectUrl's
         * URLEncoder).
         * Returning null only means the query is invalid or decoding failed; an empty
         * token value returns the empty string (valid) for the caller to fold.
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
