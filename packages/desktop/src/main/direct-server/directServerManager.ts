import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, hostname } from "node:os";
import { join } from "node:path";
import { createHttpServer } from "@zcode/server";
import {
  createServerHostServices,
  createServiceLogger,
  disposeServiceResourcesAndWait,
  getAppConfigDir,
} from "@zcode/services/node";
import type { WebRemoteControlDirectServerInfo } from "@zcode/shared";
import { resolveZCodeBuiltinProviderConfigFilePath } from "../desktopProviderConfig.js";

/**
 * Desktop local direct server (LAN direct connect + QR).
 * Spec: docs/direct-server-desktop.md — this module is the sole owner of the
 * token/port file and of the server lifecycle.
 *
 * Isomorphic to the self-hosted @zcode/server entrypoint
 * (packages/server/src/entry-http.ts): the same createHttpServer core, the same
 * token semantics (?token= → HttpOnly zcode_lite_token), and /ws is always
 * web-remote-replayable. The only differences: it runs inside the Desktop main
 * process and is torn down together with the desktop quit barrier.
 */

const log = createServiceLogger("desktop-direct-server");

/** Preferred port kept aligned with the Android docs and the self-hosted server default. */
const DEFAULT_PREFERRED_PORT = 3030;

export interface DirectServerTokenFile {
  version: 1;
  token: string;
  port: number;
}

interface DirectServerRuntime {
  services: Awaited<ReturnType<typeof createServerHostServices>>["services"];
  server: ReturnType<typeof createHttpServer>;
  port: number;
  token: string;
}

let runtime: DirectServerRuntime | null = null;
let startPromise: Promise<void> | null = null;

function resolveTokenFilePath(): string {
  return join(getAppConfigDir(), "direct-server.json");
}

export function buildDesktopServerId(hostName: string = hostname()): string {
  // serverId enters the workspace identity key (remote:server:<id>:…), so it must be
  // stable and identity-safe; normalize with the same rules as shared's
  // normalizeServerIdForIdentity, without exporting that internal helper.
  const normalized =
    hostName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "desktop";
  return `desktop-${normalized}`;
}

/** Parse the token file contents; return null when the version, token shape or port is invalid (the caller regenerates). */
export function parseDirectServerTokenFile(raw: string): DirectServerTokenFile | null {
  let parsed: Partial<DirectServerTokenFile>;
  try {
    parsed = JSON.parse(raw) as Partial<DirectServerTokenFile>;
  } catch {
    return null;
  }
  if (
    parsed.version !== 1 ||
    typeof parsed.token !== "string" ||
    !/^[0-9a-f]{32,128}$/.test(parsed.token) ||
    (parsed.port !== undefined && (typeof parsed.port !== "number" || parsed.port < 0))
  ) {
    return null;
  }
  return {
    version: 1,
    token: parsed.token,
    port: typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : DEFAULT_PREFERRED_PORT,
  };
}

async function readTokenFile(): Promise<DirectServerTokenFile | null> {
  try {
    return parseDirectServerTokenFile(await readFile(resolveTokenFilePath(), "utf-8"));
  } catch {
    return null;
  }
}

async function writeTokenFile(content: DirectServerTokenFile): Promise<void> {
  const filePath = resolveTokenFilePath();
  await mkdir(join(filePath, ".."), { recursive: true });
  // Atomic write + 0600: the token file is the sole credential for the LAN entrypoint;
  // never leave a half-written file or loose permissions behind.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => {
      probe.close(() => resolve(false));
      resolve(false);
    });
    probe.listen(port, "0.0.0.0", () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Use the preferred port when free; when taken or invalid, let the system allocate
 * a free port. A tiny race remains between the probe and the real listen; the
 * server's error listener is the backstop that logs it.
 */
export async function pickListenPort(options: {
  preferred: number;
  isPreferredFree?: (port: number) => Promise<boolean>;
  allocateEphemeral?: () => Promise<number>;
}): Promise<number> {
  const { preferred } = options;
  const preferredFree = options.isPreferredFree ?? isPortFree;
  const allocateEphemeral =
    options.allocateEphemeral ??
    (() =>
      new Promise<number>((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "0.0.0.0", () => {
          const address = probe.address();
          const port = typeof address === "object" && address ? address.port : 0;
          probe.close(() => resolve(port));
        });
      }));
  if (preferred > 0 && (await preferredFree(preferred))) {
    return preferred;
  }
  return await allocateEphemeral();
}

function collectLanIps(): string[] {
  const candidates: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      candidates.push(address.address);
    }
  }
  return candidates;
}

async function resolveStaticRoot(): Promise<string | undefined> {
  const staticRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  if (!staticRoot) return undefined;
  // Only hand the server a directory that actually exists; otherwise treat it honestly
  // as "not configured" instead of pretending pages are there.
  try {
    const staticRootStat = await stat(staticRoot);
    return staticRootStat.isDirectory() ? staticRoot : undefined;
  } catch {
    return undefined;
  }
}

export function getDesktopDirectServerInfo(): WebRemoteControlDirectServerInfo | null {
  if (!runtime) {
    return null;
  }
  const lanIps = collectLanIps();
  if (lanIps.length === 0) {
    return null;
  }
  const { port, token } = runtime;
  return {
    url: `http://${lanIps[0]}:${port}/?token=${token}`,
    port,
    lanIps,
    staticRootConfigured: Boolean(process.env["ZCODE_WEB_STATIC_ROOT"]?.trim()),
  };
}

/** Start the local direct server; idempotent (returns immediately when running or starting). Failures are logged, never thrown. */
export async function startDesktopDirectServer(): Promise<void> {
  if (runtime || startPromise) {
    return;
  }
  startPromise = (async () => {
    try {
      const providerConfigFilePath = resolveZCodeBuiltinProviderConfigFilePath();
      const persistedFromFile = await readTokenFile();
      const persisted = persistedFromFile ?? {
        version: 1 as const,
        token: randomBytes(32).toString("hex"),
        port: DEFAULT_PREFERRED_PORT,
      };
      const port = await pickListenPort({ preferred: persisted.port });
      const { services, workspaceIdentityMapper, migrationFailedPathCount } =
        await createServerHostServices({
          sourceServerId: buildDesktopServerId(),
          zcodeBuiltinProviderConfigFilePath: providerConfigFilePath,
          // The mobile replayable client never uses cross-Environment Provisioning
          // writes; keep the least privilege.
          providerProvisioningTargetEnabled: false,
        });
      const staticRoot = await resolveStaticRoot();
      const serverId = buildDesktopServerId();
      const server = createHttpServer(services, port, {
        serverId,
        name: "ZCode Desktop (LAN)",
        virtualProjects: true,
        migrationFailedPathCount,
        workspaceIdentityMapper,
        authToken: persisted.token,
        authRequired: true,
        ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
      });
      // Post-probe races or permission problems can make listen fail: never swallow the
      // unhandled error (it would crash the whole main process); log it and keep the
      // process alive. When info is unavailable the UI honestly hides the direct
      // connect section.
      server.on("error", (error: unknown) => {
        // Bugfix: post-probe listen failures (e.g. an EADDRINUSE race) leave `runtime`
        // pointing at a server nothing listens on, so the UI would show a QR/URL for a
        // dead port. Tear the runtime down through the regular dispose path instead;
        // info reads return null afterwards and the UI hides the section honestly.
        void disposeDesktopDirectServer();
        log.error("direct-server-listen-error", error);
      });
      // Bugfix: on a fresh install whose preferred port is free, port === persisted.port,
      // so gating the write on a port change alone never persisted the freshly generated
      // token — it silently rotated on every restart and phones with the saved origin got
      // 401 (spec: token is generated once and the QR stays valid across restarts).
      if (!persistedFromFile || port !== persisted.port) {
        await writeTokenFile({ ...persisted, port });
      }
      runtime = { services, server, port, token: persisted.token };
      log.info("direct-server-started", {
        port,
        staticRoot: staticRoot ?? "none",
        serverId,
      });
    } catch (error) {
      log.error("direct-server-start-failed", error);
    } finally {
      startPromise = null;
    }
  })();
  await startPromise;
}

/** Close the server and release the services graph; call inside the desktop quit barrier, no-op when not started. */
export async function disposeDesktopDirectServer(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (!current) {
    return;
  }
  await new Promise<void>((resolve) => {
    // Node ≥19 provides closeIdleConnections; without dropping idle keep-alive
    // connections the close callback fires late and eats into the quit-barrier
    // budget (same reason zcode-server-cli drains WS on close).
    (current.server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
    current.server.close(() => resolve());
  });
  await disposeServiceResourcesAndWait(current.services);
  log.info("direct-server-stopped", { port: current.port });
}
