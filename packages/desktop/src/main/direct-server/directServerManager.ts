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
 * Desktop 本地直连服务器（局域网直连 + QR）。
 * 规范：docs/direct-server-desktop.md —— 本模块是 token/port 文件与服务器生命周期的唯一所有者。
 *
 * 与自托管 @zcode/server 入口（packages/server/src/entry-http.ts）同构：同一 createHttpServer
 * 核心、同一 token 语义（?token= → HttpOnly zcode_lite_token）、/ws 永远是
 * web-remote-replayable。区别只在：跑在 Desktop main 进程内、随桌面退出屏障统一收口。
 */

const log = createServiceLogger("desktop-direct-server");

/** 偏好端口与 Android 文档、自托管 Server 默认值保持一致。 */
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
  // serverId 进入 workspace 身份键（remote:server:<id>:…），必须稳定且 identity-safe；
  // 这里与 shared 的 normalizeServerIdForIdentity 同规则收敛，但不额外导出内部工具。
  const normalized =
    hostName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "desktop";
  return `desktop-${normalized}`;
}

/** 解析 token 文件内容；版本、token 形态或端口非法时返回 null（调用方重新生成）。 */
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
  // 原子写入 + 0600：token 文件是局域网入口的唯一凭据，不能出现半截内容或宽松权限。
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
 * 偏好端口空闲就用它；被占或非法时让系统分配一个空闲端口。
 * 探测与真实 listen 之间有极小竞态，由服务器 error 监听兜底记日志。
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
  // 只在目录存在时交给服务器；不存在时如实按「未配置」处理，不假装有页面。
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

/** 启动本地直连服务器；幂等（已在跑或正在启动时直接返回）。失败不抛出，只记日志。 */
export async function startDesktopDirectServer(): Promise<void> {
  if (runtime || startPromise) {
    return;
  }
  startPromise = (async () => {
    try {
      const providerConfigFilePath = resolveZCodeBuiltinProviderConfigFilePath();
      const persisted = (await readTokenFile()) ?? {
        version: 1 as const,
        token: randomBytes(32).toString("hex"),
        port: DEFAULT_PREFERRED_PORT,
      };
      const port = await pickListenPort({ preferred: persisted.port });
      const { services, workspaceIdentityMapper, migrationFailedPathCount } =
        await createServerHostServices({
          sourceServerId: buildDesktopServerId(),
          zcodeBuiltinProviderConfigFilePath: providerConfigFilePath,
          // 手机 replayable 客户端用不到跨 Environment 的 Provisioning 写入；保持最小权限。
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
      // 探测后的竞态或权限问题会让 listen 失败：不吞掉未处理 error（会让整个 main 崩溃），
      // 只记日志并保持进程存活；UI 读不到信息时如实隐藏直连区块。
      server.on("error", (error: unknown) => {
        log.error("direct-server-listen-error", error);
      });
      if (port !== persisted.port) {
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

/** 关闭服务器并释放 services 图；在桌面退出屏障内调用，未启动时是 no-op。 */
export async function disposeDesktopDirectServer(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (!current) {
    return;
  }
  await new Promise<void>((resolve) => {
    // Node ≥19 提供 closeIdleConnections；keep-alive 空闲连接不清掉会让 close 回调
    // 迟迟不触发，拖住退出屏障的预算（同 zcode-server-cli 关闭 WS 排空的理由）。
    (current.server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
    current.server.close(() => resolve());
  });
  await disposeServiceResourcesAndWait(current.services);
  log.info("direct-server-stopped", { port: current.port });
}
