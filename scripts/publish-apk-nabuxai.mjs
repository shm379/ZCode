#!/usr/bin/env node
// publish-apk-nabuxai.mjs — Nabu APK Hub (apk.nabuxai.com) publish/queue status script
//
// Honest disclosure (findings from on-site inspection, 2026-10-26):
// - apk.nabuxai.com has no public API documentation at all (/api, /docs and /robots.txt all 404).
// - Reverse-engineering the homepage frontend JS shows it is a "build queue" service,
//   not an APK upload service:
//     GET  /api/apps             → { apps: [{ name, ref, enabled, latest: { artifactUrls } }] }
//     GET  /api/builds           → { builds: [{ id, app, status, gitUrl, commit, artifacts }] }
//     POST /api/builds {app}     → requires the x-admin-token header (401 without a token)
//     POST /api/builds/:id/cancel and GET /api/builds/:id/logs (also need x-admin-token)
//     Artifacts live under /f/<app>/<file>; object storage layout is apk/<app>/
//   The worker clones and builds itself from the gitUrl registered per app, and
//   **does not accept uploaded APK/AAB files**.
//   The endpoints above were observed from the site's own frontend code; they are not
//   backed by official docs and may change at any time.
// - As of this date, no app for this repository is registered on the hub (the only
//   existing apps are udrive-partner / udrive), so by default this script only does
//   read-only probing; actually queueing requires a hub admin to register the app server-side.
//
// Usage:
//   node scripts/publish-apk-nabuxai.mjs                 # read-only: check hub status and whether the zcode app is registered
//   node scripts/publish-apk-nabuxai.mjs --enqueue       # if the app is registered and NABUX_APKHUB_TOKEN is set, queue one build
//
// Manual publish guide (when the API app is not registered):
//   1. Ask a hub admin to register the app: name=zcode-mobile, gitUrl=https://github.com/shm379/ZCode.git, ref=main (or a mobile-v* tag).
//   2. After registration: export NABUX_APKHUB_TOKEN=<admin token requested from the admin> and run --enqueue.
//   3. Once the build finishes, take the APK link from GET /api/apps latest.artifactUrls or /f/zcode-mobile/<file>.
//   4. The fallback channel for previous APK releases is GitHub Release (tag mobile-v* triggers .github/workflows/android-release.yml automatically).
//
// This script never reads, prints or stores any token; the token is passed in only
// through the NABUX_APKHUB_TOKEN environment variable.

const HUB_BASE = process.env.NABUX_APKHUB_BASE_URL ?? 'https://apk.nabuxai.com';
const APP_NAME = process.env.NABUX_APKHUB_APP ?? 'zcode-mobile';
const enqueue = process.argv.includes('--enqueue');
const token = process.env.NABUX_APKHUB_TOKEN ?? '';

async function getJson(path) {
  const res = await fetch(new URL(path, HUB_BASE), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Nabu APK Hub: ${HUB_BASE}`);
  console.log('Note: this site has no public API docs; the endpoints below were reverse-engineered from its frontend JS and are not backed by official documentation.\n');

  let apps = [];
  try {
    const body = await getJson('/api/apps');
    apps = body.apps ?? [];
    console.log(`Registered apps: ${apps.length}`);
    for (const app of apps) {
      const latest = app.latest
        ? `${app.latest.status} @ ${app.latest.commit ?? '?'} (${(app.latest.artifactUrls ?? []).map((a) => a.url).join(', ') || 'no artifact links'})`
        : 'no successful build yet';
      console.log(`  - ${app.name}  [${app.enabled ? 'enabled' : 'disabled'}]  ref=${app.ref}  latest: ${latest}`);
    }
  } catch (err) {
    console.error(`Failed to read /api/apps: ${err.message}`);
    process.exit(1);
  }

  const app = apps.find((a) => a.name === APP_NAME);
  if (!app) {
    console.log(`\nThis repository (${APP_NAME}) is not registered on the hub → cannot queue a build.`);
    console.log('Manual step: ask a hub admin to register the app server-side (see the header comments in this file), or use the GitHub Release channel directly.');
    process.exit(2);
  }
  if (!app.enabled) {
    console.log(`\n${APP_NAME} is registered but disabled (not migrated yet) → cannot queue a build.`);
    process.exit(2);
  }

  if (!enqueue) {
    console.log(`\n${APP_NAME} is registered and usable. Run with --enqueue (and export NABUX_APKHUB_TOKEN=…) to queue one build.`);
    if (app.latest) console.log('Current latest artifacts:');
    for (const a of app.latest?.artifactUrls ?? []) console.log(`  ${a.url}`);
    return;
  }

  if (!token) {
    console.error('\n--enqueue requires the NABUX_APKHUB_TOKEN environment variable (request it from the hub admin). Not set, exiting.');
    process.exit(2);
  }

  const res = await fetch(new URL('/api/builds', HUB_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ app: APP_NAME }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Failed to queue build: HTTP ${res.status} ${body.error ?? ''}`);
    process.exit(1);
  }
  console.log(`Build queued: id=${body.id}; watch status with GET /api/builds and fetch artifacts from /f/${APP_NAME}/ when done.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
