---
name: uw-publish
description: Optional. Publish the Unwind dashboard to the scanned project's GitHub Pages gh-pages branch so it's viewable at https://<owner>.github.io/<repo>/unwind/. Builds the dashboard at the correct sub-path and commits it into an `unwind/` subdir — never blatting an existing gh-pages branch. Confirms the target, then pushes.
allowed-tools:
  - Read
  - Glob
  - Bash(mkdir:*, ls:*, rm:*)
  - Bash(git:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/**)
---

# Publish the Dashboard to GitHub Pages

**Purpose:** Publish the interactive Unwind dashboard for **this** scanned project to
its own `gh-pages` branch, so anyone can view it at
`https://<owner>.github.io/<repo>/unwind/` — no local server needed.

**Why a subdir?** GitHub Pages serves a project repo at `/<repo>/`. We publish into an
`unwind/` **subdir** of `gh-pages` and only ever replace that subdir, so an existing
`gh-pages` branch (project docs, Storybook, coverage, …) is **never blatted** — every
sibling file is preserved. A fresh branch is created as an orphan only when none exists.

> **Graceful fallback:** if `git`, `pnpm`, or `@unwind/core` are unavailable, or the
> project has no GitHub remote / no scan yet, this skill reports what's missing and
> stops cleanly (run `unwind:uw-scan` first if there's no scan).

**Safety:** all git work happens in an **isolated worktree** — your working tree and
current branch are never touched. The push is **outward-facing**, so it only happens
after you confirm the target.

## When to Use

- After scanning (and ideally analysis) when you want to **share** the dashboard.
- Re-run any time after a code/doc change to refresh the published view.

## Process

### Step 0: Preconditions

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — cannot publish dashboard"; exit 0; }
```

### Step 1: Resolve the plan (dry run — no side effects)

Show the user exactly what will happen before anything is built or pushed:

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/deploy-gh-pages.mjs" "$(pwd)" --plan
```

Relay the printed plan — **remote**, **owner/repo**, **branch action** (`create orphan`
vs `augment existing`), **subdir**, and the resulting **Pages URL**. If it reports no
git remote or no scan, stop and tell the user what to fix.

### Step 2: Build + commit, then confirm

Build the dashboard at the sub-path and commit it into the `unwind/` subdir of a local
`gh-pages` branch (still **no push**):

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/deploy-gh-pages.mjs" "$(pwd)"
```

This leaves a local `gh-pages` branch with the new commit. **Confirm with the user**
that they want to publish to the reported Pages URL.

> If the user declines, nothing was pushed. The only local artifact is the `gh-pages`
> branch; they can drop it with `git branch -D gh-pages`.

### Step 3: Push (after confirmation)

Push the prepared branch:

```bash
git push origin gh-pages
```

(Equivalently, re-run the script with `--push` to rebuild + commit + push in one shot.)

### Step 4: Report

Tell the user:
- The live URL: `https://<owner>.github.io/<repo>/unwind/`.
- **One-time setup:** enable Pages in repo **Settings → Pages → Source = `gh-pages`
  branch**. If the GitHub CLI is authenticated, this can be done once with:
  `gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=gh-pages' -f 'source[path]=/'`.
- Static deploy serves the **Graph, Coverage, Priorities, Contracts, and Docs** views;
  the live source-code viewer is dev-server-only and shows "Source unavailable" here.

## Flags (passed through to `deploy-gh-pages.mjs`)

- `--subdir <name>` — publish into a different subdir (default `unwind`).
- `--branch <name>` — Pages branch (default `gh-pages`).
- `--remote <name>` — git remote to read/push (default `origin`).
- `--base <path>` — override the Vite base path for a **custom domain / CNAME**
  (e.g. `--base /unwind/` when the repo serves at the domain root).
- `--push` — rebuild + commit + push in one step (skips the prepare-only stop).

## Notes

- **Never blats:** only `<subdir>/**` and a root `.nojekyll` are written; all other
  files on `gh-pages` are preserved. Re-running is idempotent.
- The dashboard must be **base-path aware** for sub-path hosting — the build is run
  with `VITE_BASE_URL` so asset/data fetches resolve under `/<repo>/<subdir>/`.
- This skill only reads `docs/unwind/` from the project; it writes solely to the
  isolated worktree and (on push) the remote `gh-pages` branch.
```
