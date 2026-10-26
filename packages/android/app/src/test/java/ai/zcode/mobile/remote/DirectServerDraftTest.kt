package ai.zcode.mobile.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 扫码直连草稿解析的 JVM 单测：fromUrl 与导航白名单共用同一套边界
 * （http/https + 根路径 + 仅 token 查询），relay 与 deep link 不进入直连保存流程。
 */
class DirectServerDraftTest {

    // ---------- 解析成功 ----------

    @Test
    fun `extracts plain token from root url`() {
        assertEquals(
            DirectServerDraft(
                address = "http://192.168.1.10:3030",
                label = "192.168.1.10:3030",
                token = "abc",
            ),
            DirectServerDraft.fromUrl("http://192.168.1.10:3030/?token=abc"),
        )
    }

    @Test
    fun `extracts percent-encoded token`() {
        val draft = DirectServerDraft.fromUrl("https://zcode.example.com/?token=a%2Bb%3Dc%20d")
        assertEquals("a+b=c d", draft?.token)
        // https 默认端口归一化进 origin，label 去掉 scheme 前缀用于确认弹窗展示。
        assertEquals("https://zcode.example.com", draft?.address)
        assertEquals("zcode.example.com", draft?.label)
    }

    @Test
    fun `trims surrounding whitespace before parsing`() {
        assertEquals(
            DirectServerDraft(
                address = "http://192.168.1.10:3030",
                label = "192.168.1.10:3030",
                token = "abc",
            ),
            DirectServerDraft.fromUrl("  http://192.168.1.10:3030/?token=abc  "),
        )
    }

    @Test
    fun `url without token query yields null token`() {
        assertEquals(
            DirectServerDraft(address = "http://192.168.1.10:3030", label = "192.168.1.10:3030", token = null),
            DirectServerDraft.fromUrl("http://192.168.1.10:3030"),
        )
        assertEquals(
            DirectServerDraft(address = "http://192.168.1.10:3030", label = "192.168.1.10:3030", token = null),
            DirectServerDraft.fromUrl("http://192.168.1.10:3030/"),
        )
    }

    @Test
    fun `empty token value decodes to null token`() {
        assertEquals(
            DirectServerDraft(address = "http://192.168.1.10:3030", label = "192.168.1.10:3030", token = null),
            DirectServerDraft.fromUrl("http://192.168.1.10:3030/?token="),
        )
    }

    // ---------- 拒绝 ----------

    @Test
    fun `non-root path is rejected`() {
        assertNull(DirectServerDraft.fromUrl("http://192.168.1.10:3030/remote?token=abc"))
        assertNull(DirectServerDraft.fromUrl("http://192.168.1.10:3030/index.html"))
    }

    @Test
    fun `non-token query is rejected`() {
        assertNull(DirectServerDraft.fromUrl("http://192.168.1.10:3030/?sid=1"))
        assertNull(DirectServerDraft.fromUrl("http://192.168.1.10:3030/?token=abc&other=b"))
    }

    @Test
    fun `relay url is rejected`() {
        assertNull(DirectServerDraft.fromUrl("https://zcode.z.ai/remote?sid=1&mid=2"))
        // relay 域名即使形态像直连地址也不能保存为自托管服务器。
        assertNull(DirectServerDraft.fromUrl("https://zcode.z.ai/?token=abc"))
    }

    @Test
    fun `deep link is rejected`() {
        assertNull(DirectServerDraft.fromUrl("zcode://remote?sid=1&name=My%20Mac"))
    }

    @Test
    fun `non http scheme and blank or unparseable input are rejected`() {
        assertNull(DirectServerDraft.fromUrl("ftp://192.168.1.10/?token=abc"))
        assertNull(DirectServerDraft.fromUrl("192.168.1.10:3030/?token=abc"))
        assertNull(DirectServerDraft.fromUrl("not a url"))
        assertNull(DirectServerDraft.fromUrl(""))
        assertNull(DirectServerDraft.fromUrl("   "))
        assertNull(DirectServerDraft.fromUrl(null))
    }

    @Test
    fun `malformed percent encoding is rejected instead of guessed`() {
        assertNull(DirectServerDraft.fromUrl("http://192.168.1.10:3030/?token=%zz"))
    }
}
