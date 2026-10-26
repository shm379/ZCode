# FORK.md — راهنمای فورک / Fork Guide

این سند متعلق به فورک است و با upstream ادغام نمی‌شود. بخش فارسی و بخش انگلیسی محتوای یکسانی دارند.

This document belongs to the fork and is not merged upstream. The Persian and English sections have identical content.

---

## فارسی

### این ریپو چیست؟

این ریپو یک نسخهٔ توسعه‌یافته از [ZCode](https://github.com/zai-org/ZCode) است (upstream: شاخهٔ `main`، origin این فورک: `shm379/ZCode`). علاوه بر کل کد بالادست، این موارد را اضافه می‌کند:

1. **اپ اندروید ریموت** (`packages/android/`) — پوستهٔ بومی اندروید برای صفحات `/remote`؛ اسکن QR، سرویس foreground برای پایداری پس‌زمینه و رابط چندزبانه. سند مرجع: [`docs/mobile-remote-control-android.md`](docs/mobile-remote-control-android.md).
2. **اتصال مستقیم به zcode-server بدون relay ابری** — ذخیرهٔ سرورهای مستقیم و توکن در اپ (`DirectServerStore`) و اتصال به `@zcode/server` خودمیزبان (پورت پیش‌فرض 3030) بدون نیاز به `zcode.z.ai` یا ورود با حساب Z.AI. سند مرجع فعلی بخش «直连自托管 zcode-server» در همان فایل است؛ سند سمت دسکتاپ (`docs/direct-server-desktop.md`) در کارهای بعدی فورک اضافه می‌شود.
3. **خط ریلیز اندروید** — تگ `mobile-v*`، بیلد امضاشده با GitHub Actions و انتشار APK در [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub).

### فایل‌های متعلق به فورک

این مسیرها «مالکیت فورک» هستند و در تعارض sync، نسخهٔ فورک ملاک است:

- `packages/android/` (شامل `keystore.example.properties`)
- `docs/mobile-remote-control-android.md`
- `docs/direct-server-desktop.md` (توسط کارهای بعدی فورک اضافه می‌شود)
- `FORK.md`
- بخش `<!-- FORK:BEGIN -->` … `<!-- FORK:END -->` در `README.md` و `README.en.md`
- `.github/workflows/android-release.yml` (توسط مرحلهٔ ریلیز اضافه می‌شود)
- `scripts/sync-upstream.mjs`
- خطوط `.v2c/`، `.video_agent/`، `.zcode/` در `.gitignore` ریشه

### همگام‌سازی با upstream

پیش‌نیاز: working tree تمیز باشد (کار اندرویدِ در جریان را commit یا stash کن)؛ اسکریپت با درخت کثیف merge نمی‌کند.

```bash
# پیش‌نمایش بدون merge: remote/fetch/شمارش کامیت و پیش‌بینی تعارض
node scripts/sync-upstream.mjs --dry-run

# همگام‌سازی واقعی: remote add (اگر نبود) → fetch → merge upstream/main
node scripts/sync-upstream.mjs
```

اسکریپت remote به نام `upstream` را با آدرس `https://github.com/zai-org/ZCode` اضافه می‌کند (اگر وجود نداشته باشد)، سپس fetch و merge می‌کند. در صورت تعارض، فهرست فایل‌های متعارض را با برچسب `[fork]` / `[readme]` / `[review]` چاپ می‌کند:

- `[fork]`: نسخهٔ فورک را نگه دار → `git checkout --ours -- <path> && git add <path>`
- `[readme]`: دستی ادغام کن و بلوک بین `<!-- FORK:BEGIN -->` و `<!-- FORK:END -->` را دست‌نخورده نگه دار
- `[review]`: معمولاً تغییر upstream است؛ مگر اینکه فورک آن فایل را تغییر داده باشد، نسخهٔ upstream را بگیر

پایان کار: `git commit` (تکمیل merge) یا `git merge --abort` (انصراف).

### ریلیز اندروید

1. مطمئن شو چهار secret زیر در GitHub ریپو تنظیم شده‌اند (نام‌ها همان متغیرهایی هستند که `packages/android/app/build.gradle.kts` از `keystore.properties` می‌خواند):

   | Secret | محتوا |
   | --- | --- |
   | `ZCODE_ANDROID_STORE_FILE_BASE64` | محتوای base64 فایل keystore (`zcode-release.jks`) |
   | `ZCODE_ANDROID_STORE_PASSWORD` | رمز keystore |
   | `ZCODE_ANDROID_KEY_ALIAS` | نام alias کلید (پیش‌فرض `zcode`) |
   | `ZCODE_ANDROID_KEY_PASSWORD` | رمز کلید |

2. Workflow امضا در `.github/workflows/android-release.yml` است؛ روی پوش تگ با الگوی `mobile-v*` اجرا می‌شود. نسخهٔ تگ را با `versionName` در `packages/android/app/build.gradle.kts` هم‌قد نگه دار (اولین ریلیز: `mobile-v1.0.0`).
3. `applicationId` انتشار `ai.zcode.mobile` است؛ بعد از اولین انتشار عمومی تغییرش باعث شکست آپدیت نصب‌های موجود می‌شود.
4. خروجی workflow فایل APK امضاشده است و به ریلیز همان تگ پیوست می‌شود؛ نسخهٔ نهایی در [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub) منتشر می‌شود.

### هشدار keystore

**فایل keystore (`.jks`) و رمزهایش را گم نکن.** بدون همان keystore نمی‌توان آپدیت امضاشدهٔ بعدی را برای همان `applicationId` منتشر کرد و کاربران مجبور به حذف و نصب مجدد می‌شوند. بکاپ امن خارج از ریپو (مدیر رمز یا محل ذخیره‌سازی امن) نگه دار؛ خود keystore و فایل حاوی رمز (`packages/android/keystore.properties`) هرگز commit نمی‌شوند و در `packages/android/.gitignore` مستثنی شده‌اند.

---

## English

### What is this repo?

This repository is an extended build of [ZCode](https://github.com/zai-org/ZCode) (upstream: `main` branch; this fork's origin: `shm379/ZCode`). On top of the upstream code it adds:

1. **Android remote-control app** (`packages/android/`) — a native shell for the `/remote` pages with QR scanning, a foreground service for background stability, and multi-language resources. Reference doc: [`docs/mobile-remote-control-android.md`](docs/mobile-remote-control-android.md).
2. **Direct connection to a self-hosted zcode-server, no cloud relay** — the app stores direct-server entries and tokens (`DirectServerStore`) and connects to your own `@zcode/server` instance (default port 3030) without `zcode.z.ai` or a Z.AI account login. Currently documented in the “直连自托管 zcode-server” section of the same file; the desktop-side doc (`docs/direct-server-desktop.md`) will be added by later fork work.
3. **Android release line** — `mobile-v*` tags, signed builds via GitHub Actions, and APK distribution on [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub).

### Fork-owned files

These paths are owned by the fork; on sync conflicts the fork version wins:

- `packages/android/` (including `keystore.example.properties`)
- `docs/mobile-remote-control-android.md`
- `docs/direct-server-desktop.md` (added by later fork work)
- `FORK.md`
- the `<!-- FORK:BEGIN -->` … `<!-- FORK:END -->` block in `README.md` and `README.en.md`
- `.github/workflows/android-release.yml` (added by the release stage)
- `scripts/sync-upstream.mjs`
- the `.v2c/`, `.video_agent/`, `.zcode/` lines in the root `.gitignore`

### Syncing with upstream

Prerequisite: a clean working tree (commit or stash in-flight Android work); the script refuses to merge a dirty tree.

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

2. The signing workflow lives at `.github/workflows/android-release.yml` and runs on pushes of tags matching `mobile-v*`. Keep the tag version in step with `versionName` in `packages/android/app/build.gradle.kts` (first release: `mobile-v1.0.0`).
3. The published `applicationId` is `ai.zcode.mobile`; changing it after the first public release breaks updates for existing installs.
4. The workflow attaches the signed APK to the tag's release; the final distribution goes to [apk.nabuxai.com](https://apk.nabuxai.com) (Nabu APK Hub).

### Keystore warning

**Do not lose the keystore (`.jks`) or its passwords.** Without the original keystore you cannot publish the next signed update for the same `applicationId`, and users must uninstall and reinstall. Keep a secure backup outside the repository (password manager or another secure location); the keystore and the credentials file (`packages/android/keystore.properties`) are never committed and are ignored by `packages/android/.gitignore`.
