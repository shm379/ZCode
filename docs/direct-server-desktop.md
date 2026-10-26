# Desktop Local Direct Server (Direct Server + QR)

The desktop app embeds a local HTTP/WS server so the Android shell (`packages/android`, see the
“Direct connection to a self-hosted zcode-server” section of
[docs/mobile-remote-control-android.md](./mobile-remote-control-android.md)) can reach the
desktop **over the same LAN** without going through the cloud relay, and read the chats in the
web remote-control page inside the phone's WebView.

Scope of the first version: **reading/operating existing sessions and creating sessions from the
phone** ride the exact same protocol path as a self-hosted `@zcode/server`; no new cloud relay
is created and no Z.AI account login is required.

## Architecture

```
Android shell (WebView)                 Desktop main process
┌────────────────────┐   http://<lan-ip>:<port>/?token=…   ┌──────────────────────────┐
│ DirectServerStore  │ ──────────────────────────────────► │ directServerManager      │
│ (origin+token)     │   GET / → static SPA (optional)     │  token/port file         │
│        │           │   /ws  → web-remote-replayable RPC  │  (single writer)         │
│        ▼           │ ◄────────────────────────────────── │ createHttpServer(Hono)   │
│ SPA ↔ same-origin  │        HttpOnly zcode_lite_token    │        │                 │
│       /ws          │                                     │ createServerHostServices │
└────────────────────┘                                     │  (~/.zcode/v2, same      │
                                                           │   storage)               │
                                                           └──────────────────────────┘
```

- The HTTP/WS core reuses `createHttpServer` from `@zcode/server`
  (`packages/server/src/http.ts`, exported from the package entry; desktop already inlines
  `@zcode/server` into the main bundle via tsup `noExternal`). `/ws` is always
  `web-remote-replayable`, matching the relay path semantics; `/ws/host` remains open only to a
  trusted host holding a one-time capability.
- The services graph comes from `createServerHostServices` (`@zcode/services/node`), the same
  shape as the standalone server entry in `packages/server/src/entry-http.ts`; the provider
  config reuses the desktop's existing
  `resolveZCodeBuiltinProviderConfigFilePath()` (`packages/desktop/src/main/desktopProviderConfig.ts`).
- Ownership: `directServerManager` (`packages/desktop/src/main/direct-server/directServerManager.ts`) is the
  **single owner** of the token/port file and the server lifecycle. The renderer only reads
  display info through a one-shot IPC call; it never stores, polls, or writes back.

## State and event order

```
app.whenReady
  → read setting.json custom data dir → setDataBaseDir()
  → Host finishes the tasks-index unified migration (onLocalDatabaseStartupReady)
      → startDirectServer() (async; a failure must not block startup):
          1. read/create ~/.zcode/v2/direct-server.json (token generated at random and
             persisted when missing)
          2. createServerHostServices() (idempotent migration; shares the Host's sqlite WAL +
             busy_timeout)
          3. createHttpServer(port=last port, { authToken, staticRoot?, spaFallback: true })
             port taken (EADDRINUSE) → fall back to port 0 and write the actual port back
app quit
  → prepareAppQuit barrier (in parallel with Host cleanup and cron dispose)
      → disposeDirectServer(): server.close() + disposeServiceResourcesAndWait(services)
```

- Token: 32 random hex bytes, generated **once** and persisted; the QR code stays valid across
  restarts (it does not rotate per launch).
- Port: prefers 3030 by default (matching the Android doc); the last successful port is
  persisted; when taken, the system assigns one and it is written back.
- The LAN IP shown in the UI is computed in the main process from `os.networkInterfaces()` as a
  candidate IPv4 list; the URL uses the first candidate. With multiple NICs the UI lists all
  candidates, and the QR code always encodes the full URL
  `http://<ip>:<port>/?token=<token>` — the exact format the Android `DirectServerDraft.fromUrl`
  contract accepts (root path + `?token=` only).

## Security boundary

- Token mandatory: `/ws` and `/api/*` always require `?token=` / Bearer / HttpOnly cookie
  (existing middleware in `packages/server/src/http.ts`); static files behave like the
  self-hosted server and carry no token check.
- Listens on all interfaces (LAN reachability is the point of this feature). Transport is plain
  http, as declared in the Android shell doc: the security boundary is “token + navigation
  allowlist”; use an https reverse proxy or Tailscale when you need encryption. The token is
  provided over IPC, never persisted in the renderer, and never logged.
- A replayable client on `/ws` only gets throwing stubs from Provider Provisioning even if it
  knows the channel names (an existing constraint of the core `setupChannelServer`).
- A single quit barrier: the HTTP server and the services graph must close inside the
  `before-quit` preparation barrier so no sqlite handles or Agent child processes are left over.

## “What can the phone see?” — an honest statement

- **The same on-disk data**: the direct server's services graph runs inside the main process;
  `getAppConfigDir()` (`packages/services/src/paths.ts`) resolves to the same data root as the
  desktop, `~/.zcode/v2` (including a user-configured `dataBaseDir` override, because startup
  happens after `setDataBaseDir`). tasks-index.sqlite, the session snapshot directory, and the
  Agent session store `~/.zcode/cli/db/db.sqlite` are the very same files.
- **The task list is scoped by host identity**: `createServerHostServices` binds project storage
  to the `remote:server:<serverId>` namespace (`projectStorageHostId` in
  `packages/services/src/node.ts`); the desktop window's local task rows are registered under
  `hostId: "local"` (`admitTaskGroup` in
  `packages/services/src/session/taskIndexRepo.ts`). The phone's task list therefore shows tasks
  under the direct server's identity domain (phone-created ones plus entries merged in via
  `SourceServerWorkspaceAliasRepo` for that workspace's CLI session data) and **is not
  guaranteed to be a row-for-row mirror of the desktop window's task list**.
- **Chat content itself is shared**: session message reads go through the same Agent session
  store (organized per workspace); when the phone opens a session of a workspace that exists on
  the desktop, it reads the same session data.
- The first two bullets were verified by reading the code (references above). The end-to-end
  “scan QR on the phone → see the list” scenario still needs manual verification on a real
  device; this repo currently has no Android E2E covering it.

## Serving the Web SPA (honest fallback)

The desktop installer does **not** bundle the `packages/web` build output (`extraResources` in
`electron-builder.config.js` has no web dist; `out/renderer` is the desktop's own UI, not the
mobile Web UI). Therefore:

- The static root is configured through the `ZCODE_WEB_STATIC_ROOT` environment variable (the
  same contract as the `packages/server` entry), e.g. during development
  `ZCODE_WEB_STATIC_ROOT=$(pwd)/packages/web/dist` (after `pnpm --filter @zcode/web build`).
- When it is not configured the server still starts: `/ws` and `/api/*` work, `/` returns 404,
  and the QR code scans fine but the WebView has no page. The UI states this honestly on the
  direct-connect card (`staticRootConfigured=false`) instead of pretending it works.
- Bundling the web dist with the installer is left as a follow-up (it involves installer size
  and a dual-UI versioning policy; out of scope here).

## Renderer interface

- `IPlatformService` gains an optional `getWebRemoteControlDirectServerInfo?()` (packages/shared,
  minimal change; the desktop implementation uses
  `PlatformChannels.GetWebRemoteControlDirectServerInfo`; the web client does not implement it →
  the direct-connect section is hidden entirely there).
- Display entry point: the existing `WebRemoteControlDialog` gains a “LAN direct connect” card
  (URL + copy + QR code + staticRoot hint), reusing the `qrcode` dependency and the existing
  card visuals — no new npm dependency.

## Acceptance scenarios

1. Start the desktop → `~/.zcode/v2/direct-server.json` contains a token; the remote-control
   dialog shows the direct-connect card with the QR code.
2. On the same LAN, the Android shell scans the code → confirms the save → the WebView opens
   `<origin>/?token=…`, the cookie bootstraps, and the same-origin `/ws` channel comes up
   (the Android-side contract is in its doc).
3. Quit the desktop → the direct port closes (`lsof -i :<port>` shows no listener) and no Agent
   processes are left behind.
4. If another process took the last port → the server falls back to a new port and the QR code
   shows the new one.
