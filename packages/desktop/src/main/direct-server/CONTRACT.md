# desktop-direct-server

桌面 main 进程内的局域网直连服务器（Hono HTTP/WS + 完整 server services 图），让 Android 壳
不经过云端 relay 直连桌面读取会话。规范：`docs/direct-server-desktop.md`。

不变量：

- `~/.zcode/v2/direct-server.json` 只由本模块读写；token 只生成一次（重启不轮换），
  文件原子写入且权限 0600。
- 服务器必须在 `onLocalDatabaseStartupReady` 之后启动（不与 Host 抢 tasks-index 首迁移），
  必须在 `prepareAppQuit` 并行屏障内收口（HTTP close + services dispose）。
- `/ws` 永远是 `web-remote-replayable`；token 必填（`?token=` / Bearer / HttpOnly cookie）。
  静态 SPA 走 `ZCODE_WEB_STATIC_ROOT`，缺失时 `/` 404 并如实上报 `staticRootConfigured=false`。
- 展示 URL 含 token：不进日志、不进 renderer 持久化；复制动作只在 UI 层发生。

与其它模块的交集：

- main/index.ts：只在本模块 contract 的三个方法上接线（启动门、IPC 依赖注入、退出屏障），
  不直接触碰 services 图或 token 文件。
- desktopWebRemoteControlIpc.ts：经依赖注入 `getDirectServerInfo` 暴露一次性 IPC。
