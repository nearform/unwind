#!/usr/bin/env node
/**
 * deploy-gh-pages.mjs
 *
 * Publish the Unwind dashboard to a project's GitHub Pages `gh-pages` branch so it
 * is viewable at https://<owner>.github.io/<repo>/<subdir>/. The dashboard is built
 * at the correct sub-path (VITE_BASE_URL) and committed into a SUBDIR of gh-pages so
 * an existing gh-pages branch is never blatted — only <subdir>/** is replaced, every
 * sibling file is preserved. All git work happens in an ISOLATED worktree, so the
 * user's checkout and current branch are never touched.
 *
 * Usage:
 *   node deploy-gh-pages.mjs <projectRoot> [flags]
 *
 * Flags:
 *   --subdir <name>   subdir on gh-pages to publish into        (default: unwind)
 *   --branch <name>   Pages branch                              (default: gh-pages)
 *   --remote <name>   git remote to read/push                   (default: origin)
 *   --base <path>     override the computed Vite base path (custom domains / CNAME)
 *   --plan            resolve + report the plan only; NO build, NO commit, NO push
 *   --push            push the committed branch to <remote> (outward-facing)
 *
 * Default (no --plan / --push): build + assemble + commit into a local <branch>,
 * then stop and print the exact `git push` command (prepare-only).
 *
 * Graceful: if git / pnpm / @unwind/core or the scan are unavailable, exits non-zero
 * with a clear message so the calling skill can report and stop cleanly.
 *
 * Exit codes: 0 ok · 1 usage/build error · 2 missing prerequisite (git/remote/scan).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// --- Plugin root (where packages/dashboard lives). Prefer the env the skill
// exports; fall back to two dirs up from this script (skills/scripts -> root). ---
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(
  process.env.UNWIND_PLUGIN_ROOT && existsSync(join(process.env.UNWIND_PLUGIN_ROOT, "packages/dashboard"))
    ? process.env.UNWIND_PLUGIN_ROOT
    : resolve(scriptDir, "../.."),
);

const log = (m) => process.stderr.write(`deploy-gh-pages: ${m}\n`);
const die = (code, m) => {
  log(m);
  process.exit(code);
};

// --- Parse args. ---
const argv = process.argv.slice(2);
const projectRootArg = argv.find((a) => !a.startsWith("--"));
if (!projectRootArg) {
  die(1, "Usage: node deploy-gh-pages.mjs <projectRoot> [--subdir unwind] [--branch gh-pages] [--remote origin] [--base <path>] [--plan] [--push]");
}
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
const has = (name) => argv.includes(`--${name}`);

const projectRoot = resolve(projectRootArg);
const subdir = (flag("subdir", "unwind") || "unwind").replace(/^\/+|\/+$/g, "");
const branch = flag("branch", "gh-pages");
const remote = flag("remote", "origin");
const baseOverride = flag("base", null);
const planOnly = has("plan");
const doPush = has("push");

if (!existsSync(projectRoot)) die(1, `projectRoot does not exist: ${projectRoot}`);
if (!subdir) die(1, "--subdir must not be empty");

// --- Small spawn helpers. ---
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf-8", ...opts });
}
function git(args, opts = {}) {
  return run("git", ["-C", opts.cwd || projectRoot, ...args], opts);
}
function gitOut(args, opts = {}) {
  const r = git(args, opts);
  return r.status === 0 ? (r.stdout || "").trim() : null;
}

if (run("git", ["--version"]).status !== 0) {
  die(2, "git not found — gh-pages deploy requires git.");
}
if (gitOut(["rev-parse", "--is-inside-work-tree"]) !== "true") {
  die(2, `not a git repository: ${projectRoot}`);
}

// --- Resolve the GitHub remote → owner/repo → base path + Pages URL. ---
const remoteUrl = gitOut(["remote", "get-url", remote]);
if (!remoteUrl) {
  die(2, `git remote '${remote}' not found. Add one (git remote add ${remote} <url>) or pass --remote.`);
}
function parseGitHubRemote(url) {
  url = url.trim();
  let m = url.match(/^[^@\s]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?\/?$/); // scp-style ssh
  if (m) return { owner: m[1], repo: m[2] };
  m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}
const parsed = parseGitHubRemote(remoteUrl);
if (!parsed) die(2, `could not parse owner/repo from remote URL: ${remoteUrl}`);
const { owner, repo } = parsed;

const ensureSlashes = (p) => `/${p}/`.replace(/\/{2,}/g, "/");
const isUserOrgPage = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`;
const base = baseOverride
  ? ensureSlashes(baseOverride)
  : isUserOrgPage
    ? ensureSlashes(subdir)
    : ensureSlashes(`${repo}/${subdir}`);
const host = `${owner.toLowerCase()}.github.io`;
const pagesUrl = baseOverride ? null : `https://${host}${base}`;

// --- Branch existence (drives create-orphan vs augment-existing). ---
git(["fetch", remote, branch, "--quiet"]); // best-effort; offline is fine
const localExists = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
const remoteExists = git(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`]).status === 0;
const branchExists = localExists || remoteExists;
const branchAction = branchExists ? "augment existing" : "create orphan";

// --- Report the plan (always). ---
log(`remote        ${remote} → ${remoteUrl}`);
log(`owner/repo    ${owner}/${repo}${isUserOrgPage ? "  (user/org page)" : ""}`);
log(`branch        ${branch}  (${branchAction})`);
log(`subdir        ${subdir}/`);
log(`vite base     ${base}`);
log(`pages URL     ${pagesUrl || `(custom base ${base} — set your CNAME's URL)`}`);

if (planOnly) {
  log("--plan: resolved the plan only; no build/commit/push performed.");
  process.exit(0);
}

// --- Refresh the data artifacts (graph + docs-bundle) from the current scan. ---
const docsUnwind = join(projectRoot, "docs/unwind");
const graphJson = join(docsUnwind, "rebuild-graph.json");
const docsBundleJson = join(docsUnwind, "docs-bundle.json");
const manifest = join(docsUnwind, ".cache/scan-manifest.json");

if (existsSync(manifest)) {
  log("refreshing rebuild-graph.json + docs-bundle.json from the current scan…");
  const r = run("node", [join(scriptDir, "build-graph.mjs"), projectRoot], { stdio: "inherit" });
  if (r.status !== 0) die(1, "build-graph.mjs failed — cannot publish a stale/missing graph.");
} else if (!existsSync(graphJson)) {
  die(2, "no scan found (docs/unwind/.cache/scan-manifest.json missing) and no prebuilt rebuild-graph.json — run unwind:uw-scan first.");
} else {
  log("no scan manifest — publishing the existing rebuild-graph.json as-is.");
}

// --- Build the dashboard at the sub-path. ---
const dashboardDir = join(pluginRoot, "packages/dashboard");
const distDir = join(dashboardDir, "dist");
if (!existsSync(dashboardDir)) die(1, `dashboard package not found at ${dashboardDir}`);
if (run("pnpm", ["--version"]).status !== 0) {
  die(2, "pnpm not found — required to build the dashboard.");
}
log(`building dashboard with VITE_BASE_URL=${base} …`);
const build = run("pnpm", ["--filter", "@unwind/dashboard", "build"], {
  cwd: pluginRoot,
  stdio: "inherit",
  env: { ...process.env, VITE_BASE_URL: base },
});
if (build.status !== 0) die(1, "dashboard build failed.");
if (!existsSync(join(distDir, "index.html"))) die(1, `build produced no dist/index.html at ${distDir}`);

// --- Isolated worktree (never touches the user's checkout). ---
const tmp = join(tmpdir(), `unwind-ghpages-${process.pid}-${Date.now()}`);
let worktreeAdded = false;
function cleanup() {
  if (worktreeAdded) {
    git(["worktree", "remove", "--force", tmp]);
    git(["worktree", "prune"]);
  }
}
process.on("exit", cleanup);

try {
  if (localExists) {
    if (git(["worktree", "add", tmp, branch]).status !== 0) die(1, `could not add worktree for existing branch ${branch} (already checked out elsewhere?).`);
  } else if (remoteExists) {
    if (git(["worktree", "add", "--track", "-b", branch, tmp, `${remote}/${branch}`]).status !== 0) die(1, `could not add worktree tracking ${remote}/${branch}.`);
  } else {
    // Fresh orphan branch — nothing to preserve.
    if (git(["worktree", "add", "--detach", tmp]).status !== 0) die(1, "could not create detached worktree for orphan branch.");
    worktreeAdded = true;
    if (git(["checkout", "--orphan", branch], { cwd: tmp }).status !== 0) die(1, `could not create orphan branch ${branch}.`);
    git(["rm", "-rf", "--quiet", "."], { cwd: tmp }); // clear the inherited tree
  }
  worktreeAdded = true;

  // --- Assemble into the subdir ONLY. Siblings on the branch are untouched. ---
  const subdirPath = join(tmp, subdir);
  rmSync(subdirPath, { recursive: true, force: true });
  mkdirSync(subdirPath, { recursive: true });
  cpSync(distDir, subdirPath, { recursive: true, force: true });

  // Overwrite the bundled sample graph/docs with this project's real artifacts.
  if (existsSync(graphJson)) cpSync(graphJson, join(subdirPath, "rebuild-graph.json"), { force: true });
  if (existsSync(docsBundleJson)) cpSync(docsBundleJson, join(subdirPath, "docs-bundle.json"), { force: true });

  // .nojekyll at the branch root so GitHub Pages serves assets/ and _-prefixed files verbatim.
  const nojekyll = join(tmp, ".nojekyll");
  if (!existsSync(nojekyll)) writeFileSync(nojekyll, "", "utf-8");

  // --- Commit. ---
  git(["add", "-A"], { cwd: tmp });
  const dirty = gitOut(["status", "--porcelain"], { cwd: tmp });
  if (!dirty) {
    log(`nothing changed — ${branch}:${subdir}/ is already up to date.`);
  } else {
    const changed = dirty.split("\n").filter(Boolean).length;
    const commit = git(["commit", "-m", `unwind: publish dashboard (${subdir}/)`], { cwd: tmp });
    if (commit.status !== 0) {
      die(1, `git commit failed${(commit.stderr || "").includes("identity") ? " — set git user.name/user.email." : ""}: ${(commit.stderr || "").trim()}`);
    }
    log(`committed ${changed} change(s) to ${branch} (${branchAction}).`);
  }

  // --- Push (only when asked). ---
  if (doPush) {
    log(`pushing ${branch} to ${remote} …`);
    const push = git(["push", remote, `HEAD:${branch}`], { cwd: tmp });
    if (push.status !== 0) die(1, `git push failed: ${(push.stderr || "").trim()}`);
    log("pushed ✓");
    log(`LIVE (after Pages is enabled): ${pagesUrl || base}`);
    log(`Enable once: repo Settings → Pages → Source = ${branch} branch (or: gh api -X POST repos/${owner}/${repo}/pages -f 'source[branch]=${branch}' -f 'source[path]=/')`);
  } else {
    log(`prepared local branch '${branch}'. To publish, run:`);
    log(`    git -C "${projectRoot}" push ${remote} ${branch}`);
    log(`Then enable Pages once: Settings → Pages → Source = ${branch} branch.`);
    log(`Target URL: ${pagesUrl || base}`);
  }
} finally {
  cleanup();
  worktreeAdded = false;
}
