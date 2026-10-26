#!/usr/bin/env node
// Sync this fork with the upstream repository (zai-org/ZCode).
//
// Fork-owned file (see FORK.md). Pipeline: ensure the `upstream` remote →
// `git fetch upstream` → `git merge upstream/main`. On conflict it lists the
// conflicted files classified against the fork-owned inventory (FORK.md) so
// resolution is mechanical instead of guesswork.
//
// Safety rules:
//   - a real merge requires a clean working tree (the fork keeps in-flight
//     Android work uncommitted by default — never merge over it);
//   - a merge already in progress aborts the script (finish or back out
//     that merge first);
//   - --dry-run never merges and never mutates git config: when the remote
//     is missing it fetches by URL instead.
//
// Usage:
//   node scripts/sync-upstream.mjs --dry-run   # preview: fetch + counts + conflict forecast
//   node scripts/sync-upstream.mjs             # real sync (fetch + merge)
//
// Exit codes: 0 ok / up to date, 1 merge conflict or sync failure,
// 2 usage or precondition error.

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const UPSTREAM_REMOTE = "upstream";
const UPSTREAM_URL = "https://github.com/zai-org/ZCode";
const UPSTREAM_BRANCH = "main";

// Files owned by this fork; upstream has no meaningful counterpart, so the
// fork version wins on conflict. Keep in sync with the "Fork-owned files"
// inventory in FORK.md. Trailing "/" marks a path prefix.
const FORK_OWNED_PATHS = [
  "packages/android/",
  "docs/mobile-remote-control-android.md",
  "docs/direct-server-desktop.md",
  "FORK.md",
  ".github/workflows/android-release.yml",
  "scripts/sync-upstream.mjs",
];

// Mixed files: upstream content plus a fork-managed block delimited by
// FORK markers. These must be resolved by hand, keeping the block.
const README_PATHS = ["README.md", "README.en.md"];
const FORK_BEGIN = "<!-- FORK:BEGIN -->";
const FORK_END = "<!-- FORK:END -->";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unknownArgs = args.filter((arg) => arg !== "--dry-run");
if (unknownArgs.length > 0) {
  console.error(`[sync-upstream] unknown argument(s): ${unknownArgs.join(" ")}`);
  console.error("[sync-upstream] usage: node scripts/sync-upstream.mjs [--dry-run]");
  process.exit(2);
}

const log = (message) => console.log(`[sync-upstream] ${message}`);
const die = (message, code = 1) => {
  console.error(`[sync-upstream] ${message}`);
  process.exit(code);
};

async function git(...gitArgs) {
  const { stdout } = await execFile("git", gitArgs, { encoding: "utf8" });
  return stdout.trim();
}

async function gitTry(...gitArgs) {
  try {
    const { stdout } = await execFile("git", gitArgs, { encoding: "utf8" });
    return { ok: true, stdout: stdout.trim(), stderr: "", code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout ?? "").trim(),
      stderr: (error.stderr ?? "").trim(),
      code: typeof error.code === "number" ? error.code : -1,
    };
  }
}

// "fork"  → keep the fork version (upstream has no counterpart)
// "readme"→ manual merge, preserve the FORK block
// "review"→ upstream change, manual review
function pathKind(path) {
  if (README_PATHS.includes(path)) return "readme";
  const isForkOwned = FORK_OWNED_PATHS.some((owned) =>
    owned.endsWith("/") ? path.startsWith(owned) : path === owned,
  );
  return isForkOwned ? "fork" : "review";
}

const KIND_LABELS = { fork: "[fork]  ", readme: "[readme]", review: "[review]" };

function printResolutionGuide() {
  console.log("[sync-upstream] resolution guide (details in FORK.md):");
  console.log(`  ${KIND_LABELS.fork} keep the fork version:
              git checkout --ours -- <path> && git add <path>`);
  console.log(`  ${KIND_LABELS.readme} resolve manually; keep the block between
              ${FORK_BEGIN} and ${FORK_END} intact`);
  console.log(`  ${KIND_LABELS.review} usually an upstream change; take the incoming version
              unless this fork modified the file (git log --oneline HEAD -- <path>)`);
  console.log("  finish the merge: git commit   |   back out: git merge --abort");
}

if (!(await gitTry("rev-parse", "--show-toplevel")).ok) {
  die("not inside a git repository", 2);
}

// 1) Ensure the upstream remote exists. In dry-run mode we only announce it.
let remoteUrl = null;
const remotes = (await git("remote")).split("\n").filter(Boolean);
if (remotes.includes(UPSTREAM_REMOTE)) {
  remoteUrl = await git("remote", "get-url", UPSTREAM_REMOTE);
  if (remoteUrl !== UPSTREAM_URL) {
    console.warn(
      `[sync-upstream] warning: remote ${UPSTREAM_REMOTE} points to ${remoteUrl}, expected ${UPSTREAM_URL}; using the existing one`,
    );
  }
} else if (dryRun) {
  log(`dry-run: would run: git remote add ${UPSTREAM_REMOTE} ${UPSTREAM_URL}`);
} else {
  await git("remote", "add", UPSTREAM_REMOTE, UPSTREAM_URL);
  remoteUrl = UPSTREAM_URL;
  log(`added remote ${UPSTREAM_REMOTE} -> ${UPSTREAM_URL}`);
}

// 2) Fetch. Without the remote configured (dry-run), fetch by URL so no
// config is written; FETCH_HEAD then stands in for upstream/main.
log("fetching upstream …");
let mergeRef;
if (remoteUrl !== null) {
  await git("fetch", UPSTREAM_REMOTE);
  mergeRef = `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`;
} else {
  await git("fetch", "--no-tags", UPSTREAM_URL, UPSTREAM_BRANCH);
  mergeRef = "FETCH_HEAD";
}

// 3) How far apart are we?
const incoming = Number(await git("rev-list", "--count", `HEAD..${mergeRef}`));
const ahead = Number(await git("rev-list", "--count", `${mergeRef}..HEAD`));
log(
  `fork is ahead ${ahead} commit(s) of ${mergeRef}; sync would merge ${incoming} upstream commit(s)`,
);
if (incoming === 0) {
  log("nothing to merge — already up to date");
  process.exit(0);
}

if (dryRun) {
  // Best-effort conflict forecast (git >= 2.38). Exit code 1 means conflicts
  // were forecast; stdout is the merged tree oid, then the conflicted paths,
  // then informational messages ("Auto-merging …", "CONFLICT …") which are
  // not paths and must be filtered out.
  const forecast = await gitTry("merge-tree", "--write-tree", "--name-only", "HEAD", mergeRef);
  let conflicted;
  if (forecast.ok) {
    conflicted = [];
  } else if (forecast.code === 1) {
    conflicted = forecast.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(1)
      .filter((line) => !/^(Auto-merging|CONFLICT|Skipped|ERROR|warning:)/.test(line));
  } else if (/usage|unknown (option|switch)|unrecognized argument/i.test(forecast.stderr)) {
    conflicted = null;
  } else {
    die(
      `dry-run: conflict forecast failed: ${forecast.stderr || forecast.stdout || "unknown git error"}`,
    );
  }
  if (conflicted === null) {
    log("dry-run: git merge-tree --write-tree unavailable here; skipped conflict forecast");
  } else if (conflicted.length === 0) {
    log("dry-run: no conflicts forecast for the next merge");
  } else {
    log(`dry-run: forecast predicts ${conflicted.length} conflicted file(s):`);
    for (const path of conflicted) {
      log(`  ${KIND_LABELS[pathKind(path)] ?? KIND_LABELS.review} ${path}`);
    }
    printResolutionGuide();
  }
  log("dry-run done: nothing was merged, no git config was changed");
  process.exit(0);
}

// 4) Real merge — preconditions first.
if ((await gitTry("rev-parse", "-q", "--verify", "MERGE_HEAD")).ok) {
  die("a merge is already in progress; finish it (git commit) or back out (git merge --abort) first", 2);
}
const dirty = await git("status", "--porcelain");
if (dirty !== "") {
  die(
    "working tree is not clean — commit or stash local changes before syncing (refusing to merge over in-flight fork work, e.g. packages/android)",
    2,
  );
}

log(`merging ${mergeRef} …`);
const merge = await gitTry("merge", "--no-edit", mergeRef);
if (merge.ok) {
  log(`merge complete: ${incoming} upstream commit(s) merged`);
  log("next: run pnpm verify:pre-push (at minimum pnpm typecheck && pnpm lint) before pushing");
  process.exit(0);
}

const conflicted = (await gitTry("diff", "--name-only", "--diff-filter=U"))
  .stdout.split("\n")
  .filter(Boolean);
if (conflicted.length === 0) {
  die(`merge failed: ${merge.stderr || merge.stdout || "unknown git error"}`);
}
log(`merge stopped with ${conflicted.length} conflicted file(s):`);
for (const path of conflicted) {
  log(`  ${KIND_LABELS[pathKind(path)] ?? KIND_LABELS.review} ${path}`);
}
printResolutionGuide();
process.exit(1);
