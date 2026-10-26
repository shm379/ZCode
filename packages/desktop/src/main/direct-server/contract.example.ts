/**
 * desktop-direct-server 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 对应 main/index.ts 的真实接线：启动门、退出屏障、IPC 依赖注入。
 */
import type { DesktopDirectServerContract } from "./contract.js";

export function exampleDesktopDirectServer(
  contract: DesktopDirectServerContract,
  hooks: { onLocalDatabaseStartupReady: (listener: () => void) => void },
): void {
  // 启动门：等 Host 完成 tasks-index 统一迁移后再开自己的 services 图。
  hooks.onLocalDatabaseStartupReady(() => {
    void contract.startDesktopDirectServer();
  });
  // 消费：一次性读取展示信息（同步返回）；null 时 UI 如实隐藏直连区块，不轮询、不重试。
  const info = contract.getDesktopDirectServerInfo();
  if (info) {
    // info.url 含访问 token，只允许进入剪贴板/二维码，不允许写日志。
    void navigator.clipboard.writeText(info.url).catch(() => {});
  }
  // 退出屏障：与 Host 清理并行调用一次；未启动时是 no-op。
  void contract.disposeDesktopDirectServer();
}
