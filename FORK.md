# FORK.md — Fork Guide

This document belongs to the fork and is not merged upstream.

---

## What is this repo?

This repository is an extended build of [ZCode](https://github.com/zai-org/ZCode) (upstream: `main` branch; this fork's origin: `shm379/ZCode`). On top of the upstream code it adds:

1. **Android remote-control app** (`packages/android/`) — a native shell for the `/remote` pages with QR scanning, a foreground service for background stability, and multi-language resources. Reference doc: [`docs/mobile-remote-control-android.md`](docs/mobile-remote-control-android.md).
2. **Direct connection to a self-hosted zcode-server, no cloud relay** — the app stores direct-server entries and tokens (`DirectServerStore`) and connects to your own `@zcode/server` instance (default port 3030) without `zcode.z.ai` or a Z.AI account login. The desktop side runs the same server automatically — see [`docs/direct-server-desktop.md`](docs/direct-server-desktop.md); the phone-side rules are in the “Direct connection to a self-hosted zcode-server” section of [`docs/mobile-remote-control-android.md`](docs/mobile-remote-control-android.md).
3. **Android release line** — `mobile-v*` tags, signed builds via GitHub Actions, and APK distribution on [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub).

### Fork-owned files

These paths are owned by the fork; on sync conflicts the fork version wins:

- `packages/android/` (including `keystore.example.properties`)
- `docs/mobile-remote-control-android.md`
- `docs/direct-server-desktop.md`
- `FORK.md`
- the `<!-- FORK:BEGIN -->` … `<!-- FORK:END -->` block in `README.md` and `README.en.md`
- `.github/workflows/android-release.yml`
- `scripts/sync-upstream.mjs`
- `play/` (Google Play metadata: `play/metadata`, `play/screenshots`, `play/changelogs`; published with `gplay`)
- the `.v2c/`, `.video_agent/`, `.zcode/` lines in the root `.gitignore`

### Syncing with upstream

Prerequisite: a clean working tree (commit or stash in-flight work); the script refuses to merge a dirty tree.

```bash
# Preview without merging: remote/fetch/commit counts and a conflict forecast
node scripts/sync-upstream.mjs --dry-run

# Real sync: remote add (if missing) → fetch → merge upstream/main
node scripts/sync-upstream.mjs
```

The script adds a remote named `upstream` pointing at `https://github.com/zai-org/ZCode` (when missing), then fetches and merges. On conflict it prints the conflicted files labeled `[fork]` / `[readme]` / `[review]`:

- `[fork]`: keep the fork version → `git checkout --ours -- <path> && git add <path>`
- `[readme]`: merge by hand and keep the block between `<!-- FORK:BEGIN -->` and `<!-- FORK:END -->` intact
- `[review]`: usually an upstream change; take the upstream version unless this fork modified the file

Finish with `git commit` (completes the merge) or back out with `git merge --abort`.

### Android release

1. Make sure the four GitHub secrets below are configured (the names mirror the variables `packages/android/app/build.gradle.kts` reads from `keystore.properties`):

   | Secret | Contents |
   | --- | --- |
   | `ZCODE_ANDROID_STORE_FILE_BASE64` | base64 of the keystore file (`zcode-release.jks`) |
   | `ZCODE_ANDROID_STORE_PASSWORD` | keystore password |
   | `ZCODE_ANDROID_KEY_ALIAS` | key alias (default `zcode`) |
   | `ZCODE_ANDROID_KEY_PASSWORD` | key password |

2. Publish to Google Play with `gplay` (service account at `~/.gplay/play-console-cli.json`, gitignored outside the repo):
   ```bash
   gplay release --package ai.zcode.mobile --track internal --bundle app-release.aab \
     --listings-dir play/metadata --screenshots-dir play/screenshots --release-notes @/tmp/release-notes.json
   ```
   Keep `play/metadata/en-US/changelogs/<versionCode>.txt` (moved to `play/changelogs/`) and the listing text in sync with each release.
3. The signing workflow lives at `.github/workflows/android-release.yml` and runs on pushes of tags matching `mobile-v*`. Keep the tag version in step with `versionName` in `packages/android/app/build.gradle.kts` (first release: `mobile-v1.0.0`).
3. The published `applicationId` is `ai.zcode.mobile`; changing it after the first public release breaks updates for existing installs.
4. The workflow attaches the signed APK to the tag's release; the final distribution goes to [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub).

### Keystore warning

**Do not lose the keystore (`.jks`) or its passwords.** Without the original keystore you cannot publish the next signed update for the same `applicationId`, and users must uninstall and reinstall. Keep a secure backup outside the repository (password manager or another secure location); the keystore and the credentials file (`packages/android/keystore.properties`) are never committed and are ignored by `packages/android/.gitignore`.
