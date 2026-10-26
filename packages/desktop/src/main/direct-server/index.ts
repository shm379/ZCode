/**
 * desktop-direct-server public entrypoint: main/index.ts may only import from here
 * (see architecture-policy.yaml).
 */
export {
  disposeDesktopDirectServer,
  getDesktopDirectServerInfo,
  startDesktopDirectServer,
} from "./directServerManager.js";
export type { DesktopDirectServerContract } from "./contract.js";
