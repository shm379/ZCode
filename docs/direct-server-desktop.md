# Desktop 本地直连服务器（Direct Server + QR）

桌面端在内置一个本地 HTTP/WS 服务器，让 Android 壳（`packages/android`，见
[docs/mobile-remote-control-android.md](./mobile-remote-control-android.md) 的「直连自托管
zcode-server」）在**同一局域网内**不经过云端 relay 直接连到桌面，并在手机 WebView 里打开 Web
远控页面读取聊天。

第一版能力边界：**读取/操作既有会话与从手机侧新建会话**走的是与自托管 `@zcode/server` 完全相同的
协议链路；不新建云端 relay、不要求 Z.AI 账号登录。

## 架构

```
Android 壳 (WebView)                    Desktop main 进程
┌────────────────────┐   http://<lan-ip>:<port>/?token=…   ┌──────────────────────────┐
│ DirectServerStore  │ ──────────────────────────────────► │ directServerManager      │
│ (origin+token)     │   GET / → 静态 SPA（可选）           │  token/port 文件（唯一写者）│
│        │           │   /ws  → web-remote-replayable RPC  │        │                 │
│        ▼           │ ◄────────────────────────────────── │ createHttpServer(Hono)   │
│ SPA ↔ 同源 /ws     │        HttpOnly zcode_lite_token    │        │                 │
└────────────────────┘                                     │ createServerHostServices │
                                                           │  (~/.zcode/v2 同一套存储) │
                                                           └──────────────────────────┘
```

- HTTP/WS 核心复用 `@zcode/server` 的 `createHttpServer`（`packages/server/src/http.ts`，
  从包入口 `@zcode/server` 导出，desktop 已把 `@zcode/server` 列入 tsup `noExternal` 内联进
  main bundle）。`/ws` 永远是 `web-remote-replayable`，与 relay 链路语义一致；`/ws/host`
  仍然只对持有一回性 capability 的 trusted host 开放。
- services 图来自 `createServerHostServices`（`@zcode/services/node`），与
  `packages/server/src/entry-http.ts` 的独立 Server 入口同构；provider config 复用桌面已有的
  `resolveZCodeBuiltinProviderConfigFilePath()`（`packages/desktop/src/main/desktopProviderConfig.ts`）。
- 归属：`directServerManager`（`packages/desktop/src/main/directServerManager.ts`）是 token/port
  文件与服务器生命周期的**唯一所有者**；Renderer 只通过一次性 IPC 读取展示信息，不保存、不轮询、
  不回写。

## 状态与事件顺序

```
app.whenReady
  → 读取 setting.json 自定义数据目录 → setDataBaseDir()
  → Host 完成 tasks-index 统一迁移（onLocalDatabaseStartupReady）
      → startDirectServer()（异步、失败不阻断启动）：
          1. 读/建 ~/.zcode/v2/direct-server.json（token 缺失时随机生成并落盘）
          2. createServerHostServices()（幂等迁移；与 Host 共用 WAL + busy_timeout 的 sqlite）
          3. createHttpServer(port=上次端口, { authToken, staticRoot?, spaFallback: true })
             端口被占（EADDRINUSE）→ 回落 port 0 并把实际端口写回文件
app quit
  → prepareAppQuit 屏障（与 Host 清理、cron dispose 并行）
      → disposeDirectServer()：server.close() + disposeServiceResourcesAndWait(services)
```

- token：32 字节随机 hex，**只生成一次**并持久化；重启后二维码保持有效（不随启动轮换）。
- port：默认偏好 3030（与 Android 文档一致），持久化最近成功端口；被占时系统分配并回写。
- UI 展示的局域网 IP 由 main 进程用 `os.networkInterfaces()` 计算出候选 IPv4 列表，URL 用首个
  候选；多条网卡时 UI 展示全部候选，二维码始终编码完整 URL `http://<ip>:<port>/?token=<token>`
  （该格式即 Android `DirectServerDraft.fromUrl` 的放行契约：根路径 + 仅 `?token=`）。

## 安全边界

- token 必填：`/ws` 与 `/api/*` 一律要求 `?token=` / Bearer / HttpOnly cookie
  （`packages/server/src/http.ts` 既有中间件）；静态资源同自托管 Server 一样不设 token。
- 监听所有网卡（局域网可达是该功能的前提）；传输层为明文 http，与 Android 壳文档声明一致：
  安全边界是「token + 导航白名单」，需要加密时用 https 反代或 Tailscale。token 通过 IPC 提供，
  不写进 renderer 持久化，也不进日志。
- `/ws` 上的 replayable 客户端即使知道频道名，Provider Provisioning 也只会拿到抛错 stub（核心
  `setupChannelServer` 的既有约束）。
- 退出屏障统一收口：HTTP server 与 services 图必须在 `before-quit` 预备屏障内关闭，避免
  sqlite 句柄与 Agent 子进程残留。

## 「手机能看到什么」——如实说明

- **同一份磁盘数据**：direct server 的 services 图跑在 main 进程内，`getAppConfigDir()`
  （`packages/services/src/paths.ts`）解析到与桌面同一数据根 `~/.zcode/v2`（含用户自定义
  `dataBaseDir` 覆盖，因为启动在 `setDataBaseDir` 之后）；tasks-index.sqlite、会话快照目录与
  Agent 会话库 `~/.zcode/cli/db/db.sqlite` 都是同一批文件。
- **任务列表按 host 身份分域**：`createServerHostServices` 把 project storage 绑到
  `remote:server:<serverId>` 命名空间（`packages/services/src/node.ts` 的
  `projectStorageHostId`）；桌面窗口本地的任务行登记在 `hostId: "local"` 下
  （`packages/services/src/session/taskIndexRepo.ts` 的 `admitTaskGroup`）。因此手机端任务
  列表显示的是 direct server 身份域下的任务（手机侧新建的、以及经由
  `SourceServerWorkspaceAliasRepo` 把该 workspace 的 CLI 会话数据并入后的条目），
  **不保证是桌面窗口任务列表的逐行镜像**。
- **聊天内容本身是共享的**：会话消息读取走同一 Agent 会话库（按 workspace 组织），手机端打开
  桌面上已有工作区的会话，读取的是同一份会话数据。
- 以上前两条由代码阅读证实（引用见上）；端到端「手机扫码 → 看到列表」需要在真机环境人工验证，
  本仓库当前无 Android E2E 覆盖该场景。

## Web SPA 的服务方式（如实的回退）

桌面安装包**不包含** `packages/web` 的产物（`electron-builder.config.js` 的 `extraResources`
无 web dist；`out/renderer` 是桌面自身 UI，不是手机 Web UI）。因此：

- 静态根通过环境变量 `ZCODE_WEB_STATIC_ROOT` 配置（与 `packages/server` 入口同一契约），
  例如开发态 `ZCODE_WEB_STATIC_ROOT=$(pwd)/packages/web/dist`（先 `pnpm --filter @zcode/web build`）。
- 未配置时服务器照常启动：`/ws`、`/api/*` 可用，`/` 返回 404，二维码仍可扫但 WebView 无页面。
  UI 会在直连卡片上如实提示该状态（`staticRootConfigured=false`），不假装可用。
- 把「随包内置 web dist」留作后续事项（涉及发布物体积与双 UI 版本策略，不在本次范围内）。

## Renderer 接口

- `IPlatformService` 新增可选方法 `getWebRemoteControlDirectServerInfo?()`（packages/shared，
  最小变更；Desktop 实现走 `PlatformChannels.GetWebRemoteControlDirectServerInfo`，Web 端
  不实现 → 直连区块整体隐藏）。
- 展示入口：现有 `WebRemoteControlDialog` 增加「局域网直连」卡片（URL + 复制 + 二维码 +
  staticRoot 提示），复用 `qrcode` 依赖与既有卡片视觉，不引入新 npm 依赖。

## 验收场景

1. 启动桌面 → `~/.zcode/v2/direct-server.json` 出现 token；打开远控弹窗能看到直连卡片与二维码。
2. 同一局域网 Android 壳扫码 → 确认保存 → WebView 打开 `<origin>/?token=…`，cookie 引导后
   同源 `/ws` 建立通道（Android 侧契约见其文档）。
3. 退出桌面 → 直连端口关闭（`lsof -i :<port>` 无监听），无残留 Agent 进程。
4. 上次端口被其他进程占用 → 服务器回落到新端口，二维码展示新端口。
