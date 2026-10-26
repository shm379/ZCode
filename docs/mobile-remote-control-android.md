# Android 远程控制壳

`packages/android` 当前是 ZCode 手机远控的 Android 壳。第一版不重写 ZCode Agent、relay 或
RPC 协议，而是用原生入口承载现有 `/remote` 手机 Web 远控页面。

## 入口

- 粘贴或分享 `https://zcode.z.ai/remote?...` 链接。
- 扫描桌面端生成的远控二维码；扫到自托管 zcode-server 的直连二维码时，确认后保存并连接
  （见下文「扫码」与「直连自托管 zcode-server」）。
- 通过 `zcode://remote?...` deep link 打开。
- 手动录入并保存自托管 zcode-server 地址直连（见下文「直连自托管 zcode-server」）。
- 首页会保存最近 5 条成功打开过的远控链接，App 重启后可以直接点开。列表只展示设备名、host
  和时间；实际完整链接保存在 App 私有 `SharedPreferences` 中。

生产包只允许打开 `https://zcode.z.ai/remote`。Debug 包额外允许 localhost 和局域网
`/remote`，方便真机调试本地 Vite 页面。

## 扫码

扫码使用 CameraX 预览和 ML Kit Barcode Scanning。扫描器只识别 QR Code，扫到内容后仍交给
`RemoteControlUrlPolicy` 校验：relay 链接、`zcode://remote` 深链与已保存直连 origin 的链接
按原有流程直接打开。

白名单拒绝的内容再按直连服务器地址解析（`DirectServerDraft.fromUrl`，纯 JVM 可单测）：
仅接受 http/https、根路径、查询只含 `?token=` 的地址；relay 域名（`zcode.z.ai`）与深链
一律返回 null，永远走原流程。解析成功时弹出确认框「保存并连接到 <host:port>？」：

- 确认：`DirectServerStore.save` 写入归一化 origin 与可选令牌，随后按 `buildConnectUrl`
  打开连接（仍走 `openRemoteUrl` 的白名单校验，不引入第二条放行路径）。
- 取消：不做任何写入。

两条路径都解析失败时仍提示二维码无效，不进入 WebView。

## 后台稳定性

远控页面打开后，App 会启动前台服务并保持屏幕常亮。前台服务的作用是降低 Android 在后台回收进程
或收紧网络的概率；它不改变业务事实源。手机端断线或恢复仍依赖现有 Web 远控的
`web-remote-replayable` 语义、bridge 重建和 task snapshot 对齐。

Android App 不创建独立 Agent runtime、local host 或 SSH/WSL/Docker session。手机端仍只能 attach
到桌面窗口已经存在的 host。

## 直连自托管 zcode-server

除官方 relay（`https://zcode.z.ai/remote`）外，壳支持直连用户自己的 `@zcode/server` 实例
（`packages/server`，默认端口 3030）。该实例同时承载 Web SPA（`ZCODE_WEB_STATIC_ROOT`）与
`/ws` 通道，因此该路径不需要 relay，也不需要 Z.AI 账号登录。

桌面端内置的同款服务器见 [docs/direct-server-desktop.md](./direct-server-desktop.md)：桌面 main
进程在启动后自动运行本地直连服务器（token 持久化在 `~/.zcode/v2/direct-server.json`），远控弹窗
的「局域网直连」卡片会生成 `http://<lan-ip>:<port>/?token=…` 二维码，本壳扫码后走下述同一条
保存与连接路径。注意该卡片需要桌面侧配置 `ZCODE_WEB_STATIC_ROOT` 才有 Web 页面；未配置时壳能
建立 `/ws` 连接但 WebView 无内容（桌面 UI 会如实提示）。

- 启动页提供「直连服务器」区块：手动录入服务器地址（如 `192.168.1.10:3030`、
  `https://zcode.example.com`）与可选访问令牌（服务端 `ZCODE_SERVER_AUTH_TOKEN`）。
- 除手动录入外，扫码识别的直连地址（`DirectServerDraft.fromUrl`）经用户确认后走同一套
  保存与连接路径，最终仍落到 `DirectServerStore.save` + `buildConnectUrl`。
- 服务器条目保存在 App 私有 `SharedPreferences`（`DirectServerStore`）：origin、展示名与令牌。
  令牌与历史远控链接同一安全级别；后续可升级 EncryptedSharedPreferences。
- 连接时打开 `<origin>/?token=<token>`：服务端把 token 写成 HttpOnly cookie
  （`zcode_lite_token`），SPA 再用同源 `/ws` 建立通道。
- URL 白名单新增一条：release 构建中，主框架 URL 仅当 origin 与某个已保存服务器完全一致、
  path 为 `/` 时放行（允许 `?token=` 查询用于 cookie 引导）。其余导航规则不变，壳仍不可当
  任意浏览器使用；不匹配的链接仍交给系统浏览器。
- 因此 release 构建放开 `usesCleartextTraffic`（局域网 http 服务器）。该路径的安全边界是
  导航白名单与服务器令牌，而非传输层加密；需要传输加密时请用 https 或 Tailscale HTTPS。

## Release 构建与签名

- `applicationId`/namespace 为 `ai.zcode.mobile`（发布前可改为自有域名反向 id；deep link
  `zcode://remote` 不依赖 applicationId）。
- release 签名从 `packages/android/keystore.properties`（已 gitignore，模板见
  `keystore.example.properties`）或 `~/.gradle/zcode-android-release.properties` 读取：
  `ZCODE_ANDROID_STORE_FILE`、`ZCODE_ANDROID_STORE_PASSWORD`、
  `ZCODE_ANDROID_KEY_ALIAS`、`ZCODE_ANDROID_KEY_PASSWORD`。keystore 文件与含口令的
  properties 不得提交。配置缺失时 `assembleRelease` 产出未签名 APK 而不是构建失败。
- 生成 keystore：

  ```bash
  keytool -genkeypair -v -keystore zcode-release.jks -keyalg RSA -keysize 2048 \
    -validity 10000 -alias zcode
  ```

- 产物：`./gradlew :app:assembleRelease`（APK，适合 sideload）与
  `./gradlew :app:bundleRelease`（AAB，适合商店）。首个 release 保持
  `isMinifyEnabled = false`，启用压缩与 shrink 作为后续事项。
