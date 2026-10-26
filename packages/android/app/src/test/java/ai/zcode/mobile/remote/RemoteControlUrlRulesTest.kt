package ai.zcode.mobile.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 直连服务器与 relay 白名单的 JVM 单测。规则本体不依赖 android 类，
 * 因此 debug/release 行为都能在同一套测试里直接覆盖。
 */
class RemoteControlUrlRulesTest {
    private val defaultRemoteUrl = "https://zcode.z.ai/remote"
    private val releaseConfig = RemoteControlUrlPolicyConfig(
        debug = false,
        directServerOrigins = setOf(
            "http://192.168.1.10:3030",
            "https://zcode.example.com",
        ),
    )
    private val debugConfig = releaseConfig.copy(debug = true)

    // ---------- relay 官方规则 ----------

    @Test
    fun `release allows https zcode zai remote links`() {
        assertTrue(
            RemoteControlUrlRules.isAllowed("https://zcode.z.ai/remote/v4?sid=1&mid=2", releaseConfig),
        )
    }

    @Test
    fun `release rejects cleartext relay host`() {
        assertFalse(RemoteControlUrlRules.isAllowed("http://zcode.z.ai/remote", releaseConfig))
    }

    @Test
    fun `release rejects relay host with other path`() {
        assertFalse(RemoteControlUrlRules.isAllowed("https://zcode.z.ai/other", releaseConfig))
    }

    // ---------- 直连服务器规则 ----------

    @Test
    fun `release allows saved origin root with token query`() {
        assertTrue(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/?token=abc", releaseConfig))
    }

    @Test
    fun `release allows saved origin root without query`() {
        assertTrue(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/", releaseConfig))
        assertTrue(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030", releaseConfig))
    }

    @Test
    fun `release rejects non-token query keys on saved origin`() {
        assertFalse(
            RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/?token=a&other=b", releaseConfig),
        )
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/?other=b", releaseConfig))
    }

    @Test
    fun `release rejects non-root path on saved origin`() {
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/remote", releaseConfig))
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/index.html", releaseConfig))
    }

    @Test
    fun `release rejects unsaved origins`() {
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.99:3030/?token=abc", releaseConfig))
        assertFalse(RemoteControlUrlRules.isAllowed("https://zcode.example.com/", debugConfig.copy(directServerOrigins = emptySet())))
    }

    @Test
    fun `scheme or port mismatch on saved host is rejected`() {
        assertFalse(RemoteControlUrlRules.isAllowed("https://192.168.1.10:3030/?token=abc", releaseConfig))
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3031/?token=abc", releaseConfig))
    }

    @Test
    fun `default https port normalizes to saved portless origin`() {
        assertTrue(RemoteControlUrlRules.isAllowed("https://zcode.example.com/?token=abc", releaseConfig))
        assertTrue(RemoteControlUrlRules.isAllowed("https://zcode.example.com:443/?token=abc", releaseConfig))
        // 显式 443 与省略端口是同一个 origin，但 80 不是。
        assertFalse(RemoteControlUrlRules.isAllowed("http://zcode.example.com:80/?token=abc", releaseConfig))
    }

    @Test
    fun `empty token value still matches token-only query rule`() {
        assertTrue(RemoteControlUrlRules.isAllowed("http://192.168.1.10:3030/?token=", releaseConfig))
    }

    // ---------- debug 额外放行 ----------

    @Test
    fun `debug allows lan and localhost remote pages`() {
        assertTrue(RemoteControlUrlRules.isAllowed("http://192.168.1.5:5173/remote?sid=1", debugConfig))
        assertTrue(RemoteControlUrlRules.isAllowed("http://localhost:5173/remote", debugConfig))
        assertTrue(RemoteControlUrlRules.isAllowed("http://10.0.2.2:5173/remote", debugConfig))
    }

    @Test
    fun `debug lan rule still requires remote path and rejects public hosts`() {
        assertFalse(RemoteControlUrlRules.isAllowed("http://192.168.1.5:5173/", debugConfig))
        assertFalse(RemoteControlUrlRules.isAllowed("http://evil.example.com/remote", debugConfig))
    }

    // ---------- 深链与空值 ----------

    @Test
    fun `deep link rewrites onto default remote url without re-encoding`() {
        assertEquals(
            "https://zcode.z.ai/remote?sid=1&name=My%20Mac",
            RemoteControlUrlRules.resolve("zcode://remote?sid=1&name=My%20Mac", releaseConfig, defaultRemoteUrl),
        )
    }

    @Test
    fun `blank input resolves to null`() {
        assertNull(RemoteControlUrlRules.resolve(null, releaseConfig, defaultRemoteUrl))
        assertNull(RemoteControlUrlRules.resolve("   ", releaseConfig, defaultRemoteUrl))
    }

    @Test
    fun `resolve returns trimmed url for allowed input`() {
        assertEquals(
            "http://192.168.1.10:3030/?token=abc",
            RemoteControlUrlRules.resolve("  http://192.168.1.10:3030/?token=abc  ", releaseConfig, defaultRemoteUrl),
        )
    }
}
