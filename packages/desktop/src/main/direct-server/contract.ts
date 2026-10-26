/**
 * desktop-direct-server 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 *
 * 规范：docs/direct-server-desktop.md。本模块是局域网直连服务器生命周期与
 * `~/.zcode/v2/direct-server.json`（token/port）的唯一所有者。
 */
import type { WebRemoteControlDirectServerInfo } from "@zcode/shared";

export interface DesktopDirectServerContract {
  /**
   * 启动本地直连服务器。幂等：已在运行或正在启动时立即返回。
   * 前置：main 已完成 setDataBaseDir 与 Host 数据迁移（onLocalDatabaseStartupReady 之后）。
   * 后置：服务器监听（偏好端口或回落端口），token/port 持久化完成；失败只记日志不抛出。
   */
  startDesktopDirectServer(): Promise<void>;

  /**
   * 读取展示信息（URL、局域网 IP 候选、端口、staticRootConfigured）。
   * 未启动或没有局域网 IPv4 时返回 null；每次调用即时重算网卡，不缓存。
   * URL 含访问 token：消费方不得写日志、不得持久化。
   */
  getDesktopDirectServerInfo(): WebRemoteControlDirectServerInfo | null;

  /**
   * 关闭 HTTP 服务器并释放 services 图（disposeServiceResourcesAndWait）。
   * 未启动时是 no-op；只在桌面退出屏障内调用。
   */
  disposeDesktopDirectServer(): Promise<void>;
}
