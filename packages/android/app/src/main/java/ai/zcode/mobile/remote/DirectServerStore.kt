package ai.zcode.mobile.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.UUID

/**
 * 用户保存的直连 zcode-server 条目。origin 归一化后持久化在 App 私有
 * SharedPreferences（与历史远控链接同级安全；升级 EncryptedSharedPreferences 是后续项）。
 *
 * 连接地址由 [buildConnectUrl] 生成：`<origin>/?token=<token>`。服务端会把
 * token 写成 HttpOnly cookie，随后 SPA 用同源 `/ws` 建立通道；该地址按构造
 * 即满足 [RemoteControlUrlPolicy] 的直连放行规则（origin 一致 + 根路径 + 仅 token）。
 */
data class DirectServer(
    val id: String,
    val origin: String,
    val label: String,
    val token: String?,
)

sealed interface DirectServerSaveResult {
    data class Success(val servers: List<DirectServer>) : DirectServerSaveResult
    data class Invalid(val reason: Reason) : DirectServerSaveResult

    enum class Reason {
        /** 地址不是 http/https 的 host[:port]（或带了路径/查询）。 */
        BAD_URL,

        /** 同一 origin 已保存过。 */
        DUPLICATE,
    }
}

object DirectServerStore {
    private const val PREFS_NAME = "zcode_direct_servers"
    private const val KEY_SERVERS = "servers_v1"
    private val lock = Any()

    fun read(context: Context): List<DirectServer> {
        val raw = prefs(context).getString(KEY_SERVERS, null) ?: return emptyList()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id").takeIf { it.isNotBlank() } ?: continue
                val origin = item.optString("origin").takeIf { it.isNotBlank() } ?: continue
                val label = item.optString("label").takeIf { it.isNotBlank() } ?: continue
                val token = item.optString("token").takeIf { it.isNotBlank() }
                add(DirectServer(id = id, origin = origin, label = label, token = token))
            }
        }
    }

    fun savedOrigins(context: Context): Set<String> = read(context).map { it.origin }.toSet()

    fun find(context: Context, id: String): DirectServer? = read(context).firstOrNull { it.id == id }

    fun save(context: Context, address: String, token: String?): DirectServerSaveResult {
        val parsed = parseAddress(address) ?: return DirectServerSaveResult.Invalid(
            DirectServerSaveResult.Reason.BAD_URL,
        )
        synchronized(lock) {
            val current = read(context)
            if (current.any { it.origin == parsed.origin }) {
                return DirectServerSaveResult.Invalid(DirectServerSaveResult.Reason.DUPLICATE)
            }
            val server = DirectServer(
                id = UUID.randomUUID().toString(),
                origin = parsed.origin,
                label = parsed.label,
                token = token?.trim()?.takeIf { it.isNotEmpty() },
            )
            val updated = current + server
            write(context, updated)
            return DirectServerSaveResult.Success(updated)
        }
    }

    fun delete(context: Context, id: String): List<DirectServer> = synchronized(lock) {
        val updated = read(context).filterNot { it.id == id }
        write(context, updated)
        updated
    }

    fun buildConnectUrl(server: DirectServer): String {
        val token = server.token?.takeIf { it.isNotBlank() } ?: return "${server.origin}/"
        val encoded = URLEncoder.encode(token, Charsets.UTF_8.name())
        return "${server.origin}/?token=$encoded"
    }

    /** 地址只接受 http/https 的 host[:port]；无 scheme 时按局域网习惯补 http://。 */
    private fun parseAddress(address: String): ParsedAddress? {
        val trimmed = address.trim()
        if (trimmed.isEmpty()) {
            return null
        }
        val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
        val uri = runCatching { URI(withScheme) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme != "http" && scheme != "https") {
            return null
        }
        val host = uri.host?.lowercase()
        if (host.isNullOrEmpty()) {
            return null
        }
        val path = uri.rawPath.orEmpty()
        if (path.isNotEmpty() && path != "/") {
            return null
        }
        if (!uri.rawQuery.isNullOrEmpty()) {
            return null
        }
        val defaultPort = if (scheme == "https") 443 else 80
        val explicitPort = uri.port > 0 && uri.port != defaultPort
        val hostPart = if (host.contains(':')) "[$host]" else host
        val label = if (explicitPort) "$hostPart:${uri.port}" else hostPart
        val origin = RemoteControlUrlRules.normalizeOrigin(scheme, host, uri.port)
        return ParsedAddress(origin = origin, label = label)
    }

    private data class ParsedAddress(val origin: String, val label: String)

    private fun write(context: Context, servers: List<DirectServer>) {
        val array = JSONArray()
        servers.forEach { server ->
            array.put(
                JSONObject()
                    .put("id", server.id)
                    .put("origin", server.origin)
                    .put("label", server.label)
                    .put("token", server.token.orEmpty()),
            )
        }
        prefs(context).edit().putString(KEY_SERVERS, array.toString()).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
