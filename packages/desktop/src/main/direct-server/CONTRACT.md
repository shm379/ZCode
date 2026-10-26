# desktop-direct-server

LAN direct server inside the desktop main process (Hono HTTP/WS + the full server
services graph), letting the Android shell read desktop sessions directly without
going through the cloud relay. Spec: `docs/direct-server-desktop.md`.

Invariants:

- `~/.zcode/v2/direct-server.json` is read/written only by this module; the token is
  generated once (never rotated across restarts), and the file is written atomically
  with 0600 permissions.
- The server must start after `onLocalDatabaseStartupReady` (never racing the Host
  for the first tasks-index migration) and must be torn down inside the
  `prepareAppQuit` parallel barrier (HTTP close + services dispose).
- `/ws` is always `web-remote-replayable`; the token is mandatory
  (`?token=` / Bearer / HttpOnly cookie). The static SPA is served from
  `ZCODE_WEB_STATIC_ROOT`; when missing, `/` returns 404 and
  `staticRootConfigured=false` is reported honestly.
- The display URL contains the token: never in logs, never persisted in the
  renderer; copying happens only at the UI layer.

Intersections with other modules:

- main/index.ts: wires only the three contract methods (startup gate, IPC
  dependency injection, quit barrier); it never touches the services graph or the
  token file directly.
- desktopWebRemoteControlIpc.ts: exposes the one-shot IPC through the injected
  `getDirectServerInfo`.
