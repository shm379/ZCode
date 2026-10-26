/**
 * desktop-direct-server 公开入口：main/index.ts 只允许从这里导入（见 architecture-policy.yaml）。
 */
export {
  disposeDesktopDirectServer,
  getDesktopDirectServerInfo,
  startDesktopDirectServer,
} from "./directServerManager.js";
export type { DesktopDirectServerContract } from "./contract.js";
