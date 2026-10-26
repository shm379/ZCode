/**
 * desktop-direct-server canonical usage example: agents write code by imitation,
 * and this is exactly the shape to imitate.
 * Mirrors the real wiring in main/index.ts: startup gate, quit barrier, IPC injection.
 */
import type { DesktopDirectServerContract } from "./contract.js";

export function exampleDesktopDirectServer(
  contract: DesktopDirectServerContract,
  hooks: { onLocalDatabaseStartupReady: (listener: () => void) => void },
): void {
  // Startup gate: wait for the Host to finish the unified tasks-index migration
  // before opening this module's services graph.
  hooks.onLocalDatabaseStartupReady(() => {
    void contract.startDesktopDirectServer();
  });
  // Consumption: read display info once (synchronous); on null the UI honestly hides
  // the direct-connect section — no polling, no retry.
  const info = contract.getDesktopDirectServerInfo();
  if (info) {
    // info.url contains the access token: it may only reach the clipboard/QR code,
    // never a log.
    void navigator.clipboard.writeText(info.url).catch(() => {});
  }
  // Quit barrier: called once, in parallel with Host cleanup; no-op when not started.
  void contract.disposeDesktopDirectServer();
}
