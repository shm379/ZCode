/**
 * desktop-direct-server public contract: everything a caller must know to use it
 * correctly lives here; everything else stays invisible outside the module.
 * Each method comment states: pre/post conditions, idempotency, emitted events,
 * and whether persistence is awaited.
 *
 * Spec: docs/direct-server-desktop.md. This module is the sole owner of the LAN
 * direct server lifecycle and of `~/.zcode/v2/direct-server.json` (token/port).
 */
import type { WebRemoteControlDirectServerInfo } from "@zcode/shared";

export interface DesktopDirectServerContract {
  /**
   * Start the local direct server. Idempotent: returns immediately when already
   * running or already starting.
   * Precondition: main has finished setDataBaseDir and the Host data migration
   * (after onLocalDatabaseStartupReady).
   * Postcondition: the server is listening (preferred or fallback port) and the
   * token/port persistence is complete; failures are only logged, never thrown.
   */
  startDesktopDirectServer(): Promise<void>;

  /**
   * Read display info (URL, LAN IP candidates, port, staticRootConfigured).
   * Returns null when not started or when there is no LAN IPv4; every call re-reads
   * the network interfaces on the spot, no caching.
   * The URL contains the access token: consumers must not log it or persist it.
   */
  getDesktopDirectServerInfo(): WebRemoteControlDirectServerInfo | null;

  /**
   * Close the HTTP server and release the services graph
   * (disposeServiceResourcesAndWait).
   * No-op when not started; only call inside the desktop quit barrier.
   */
  disposeDesktopDirectServer(): Promise<void>;
}
