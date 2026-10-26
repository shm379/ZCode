/**
 * desktop-direct-server module manifest (architecture-governance managed module).
 * Layer: adapters. When changing requires, update architecture-policy.yaml in sync
 * (the checker validates that both agree).
 */
export const desktopDirectServerModule = {
  id: "desktop-direct-server",
  requires: ["desktop", "server", "services", "shared"],
  provides: ["desktop-direct-server"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
