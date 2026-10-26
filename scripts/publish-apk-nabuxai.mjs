#!/usr/bin/env node
// publish-apk-nabuxai.mjs — Nabu APK Hub (apk.nabuxai.com) 发布/排队状态检查脚本
//
// 诚实声明（2026-10-26 实地核查结论）：
// - apk.nabuxai.com 没有任何公开的 API 文档（/api、/docs、/robots.txt 均 404）。
// - 首页前端 JS 反推出来它是一个「构建排队」服务而不是 APK 上传服务：
//     GET  /api/apps             → { apps: [{ name, ref, enabled, latest: { artifactUrls } }] }
//     GET  /api/builds           → { builds: [{ id, app, status, gitUrl, commit, artifacts }] }
//     POST /api/builds {app}     → 需要请求头 x-admin-token（无 token 返回 401）
//     POST /api/builds/:id/cancel、GET /api/builds/:id/logs（同样需要 x-admin-token）
//     成品文件在 /f/<app>/<file>，对象存储约定为 apk/<app>/
//   worker 按 app 登记的 gitUrl 自行 clone+构建，**不接收上传的 APK/AAB 文件**。
//   以上端点为从站点自身前端代码观察所得，未经官方文档背书，可能随时变化。
// - 截至本日，hub 上没有为本仓库注册的 app（现有 app 只有 udrive-partner / udrive），
//   因此本脚本默认只做只读探测；真正的排队需要 hub 管理员在服务端登记 app。
//
// 用法：
//   node scripts/publish-apk-nabuxai.mjs                 # 只读：检查 hub 状态与 zcode app 是否已登记
//   node scripts/publish-apk-nabuxai.mjs --enqueue       # 若 app 已登记且 NABUX_APKHUB_TOKEN 已设置，则排队一次构建
//
// 手动发布指引（当 API 未登记时）：
//   1. 找 hub 管理员登记 app：name=zcode-mobile、gitUrl=https://github.com/shm379/ZCode.git、ref=main（或 mobile-v* 标签）。
//   2. 登记 app 后：export NABUX_APKHUB_TOKEN=<向管理员索取的 admin token> 再运行 --enqueue。
//   3. 构建完成后从 GET /api/apps 的 latest.artifactUrls 或 /f/zcode-mobile/<file> 取 APK 链接。
//   4. 此前发布 APK 的兜底渠道是 GitHub Release（tag mobile-v* 自动触发 .github/workflows/android-release.yml）。
//
// 本脚本不会读取、打印或存储任何 token；token 只通过环境变量 NABUX_APKHUB_TOKEN 传入。

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
  console.log('注意：该站点没有公开 API 文档；以下端点从站点前端 JS 反推，未获官方文档背书。\n');

  let apps = [];
  try {
    const body = await getJson('/api/apps');
    apps = body.apps ?? [];
    console.log(`已登记 app：${apps.length} 个`);
    for (const app of apps) {
      const latest = app.latest
        ? `${app.latest.status} @ ${app.latest.commit ?? '?'}（${(app.latest.artifactUrls ?? []).map((a) => a.url).join(', ') || '无产物链接'}）`
        : '尚无成功构建';
      console.log(`  - ${app.name}  [${app.enabled ? 'enabled' : 'disabled'}]  ref=${app.ref}  最新: ${latest}`);
    }
  } catch (err) {
    console.error(`读取 /api/apps 失败：${err.message}`);
    process.exit(1);
  }

  const app = apps.find((a) => a.name === APP_NAME);
  if (!app) {
    console.log(`\n本仓库（${APP_NAME}）尚未在 hub 登记 → 无法排队构建。`);
    console.log('手动步骤：请 hub 管理员在服务端登记 app（见本文件头部注释），或直接使用 GitHub Release 渠道。');
    process.exit(2);
  }
  if (!app.enabled) {
    console.log(`\n${APP_NAME} 已登记但 disabled（not migrated yet）→ 无法排队构建。`);
    process.exit(2);
  }

  if (!enqueue) {
    console.log(`\n${APP_NAME} 已登记且可用。加 --enqueue（并 export NABUX_APKHUB_TOKEN=…）可排队一次构建。`);
    if (app.latest) console.log('当前最新产物：');
    for (const a of app.latest?.artifactUrls ?? []) console.log(`  ${a.url}`);
    return;
  }

  if (!token) {
    console.error('\n--enqueue 需要 NABUX_APKHUB_TOKEN 环境变量（向 hub 管理员索取）。未设置，退出。');
    process.exit(2);
  }

  const res = await fetch(new URL('/api/builds', HUB_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ app: APP_NAME }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`排队失败：HTTP ${res.status} ${body.error ?? ''}`);
    process.exit(1);
  }
  console.log(`已排队构建：id=${body.id}；用 GET /api/builds 观察状态，完成后从 /f/${APP_NAME}/ 取产物。`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
