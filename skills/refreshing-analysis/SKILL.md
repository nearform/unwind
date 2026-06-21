---
name: refreshing-analysis
description: Use to update an existing Unwind analysis after code changes — re-analyzes only the affected layers instead of re-unwinding the whole codebase
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git:*, mkdir:*, ls:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/.cache/**)
  - Write(docs/unwind/**)
  - Edit(docs/unwind/**)
  - Task
---

# Refreshing Analysis (Incremental Update)

Keep the unwind docs and `rebuild-graph.json` fresh across a long migration
**without** re-unwinding everything. The deterministic scan fingerprints every
file; a refresh re-analyzes only the layers whose source actually changed and
flags previously-documented items whose source changed structurally as **stale**.

**Requires:** a prior full run (so `docs/unwind/.cache/meta.json` baseline + layer
docs + `coverage/` exist).
**Produces:** updated layer docs, refreshed `coverage/`, and a regenerated
`rebuild-graph.json` with `coverage: "stale"` / `rebuildStatus: "needs-recheck"`
on changed contracts.

> **Graceful fallback:** if `@unwind/core`/Node/pnpm is unavailable, skip the
> deterministic steps and fall back to the legacy `unwind:unwinding-codebase`
> Refresh Mode (re-run specialists with previous docs as context).

## The Process

### Step 1: Detect changes (deterministic)

Run change detection against the baseline. **Order matters** — this must run
*before* re-scanning, so the baseline still reflects the last analyzed state.

```bash
source "$(dirname "$0")/../scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — using legacy refresh"; }
node "$UNWIND_PLUGIN_ROOT/skills/scripts/detect-changes.mjs" "$(pwd)"
```

This writes `docs/unwind/.cache/changes.json`:
- `structural` / `added` / `removed` — files whose contract surface moved
- `cosmetic` — body/comment-only edits (docs stay valid; no re-analysis)
- `affectedLayers` — the only layers that need re-analysis
- `staleItems` — documented item ids whose source changed structurally
- `newItems` — item ids in newly-added files (become gaps after verify)

If `structural`, `added`, and `removed` are all empty → **nothing to do**; the
docs and graph remain valid. Stop here.

### Step 2: Refresh the baseline scan

Re-run the scan to refresh `scan-manifest.json` + the `meta.json` baseline so
item ids match the current code:

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/scan.mjs" "$(pwd)"
node "$UNWIND_PLUGIN_ROOT/skills/scripts/seed-layers.mjs" "$(pwd)"
```

### Step 3: Re-analyze ONLY the affected layers

For each layer in `changes.affectedLayers`, dispatch the matching
`unwind:analyzing-*` specialist (see `unwind:unwinding-codebase` for dispatch
mechanics), seeded with `docs/unwind/.cache/seeds/{layer}.json` and the existing
layer docs as context. Instruct it to:
- document any **new** items (in `changes.newItems`),
- re-confirm any **stale** items (in `changes.staleItems`) — the signature moved,
- remove docs for items in `changes.removed` files that no longer exist.

Do **not** touch layers absent from `affectedLayers`.

### Step 4: Verify + complete + regenerate the graph

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/verify-coverage.mjs" "$(pwd)"
# (loop verify -> unwind:completing-layer-documentation until affected layers are 100%)
node "$UNWIND_PLUGIN_ROOT/skills/scripts/build-graph.mjs" "$(pwd)"
```

`build-graph` reads `changes.json` and marks still-documented-but-changed nodes
`coverage: "stale"`; any `done`/`verified` **contract** whose source changed
structurally flips to `rebuildStatus: "needs-recheck"` (human-set progress in
`rebuild-progress.json` is otherwise preserved).

### Step 5: Report

Summarize: layers re-analyzed, items added/removed, stale items resolved, and
the new coverage %. Point to `docs/unwind/rebuild-graph.json` for the dashboard.

## Why incremental

A full unwind re-runs every specialist over every file. A refresh skips the
deterministic re-scan's cosmetic churn and only pays for LLM analysis on layers
that actually changed — turning the unwind spec into a living document that
tracks the codebase across months of migration work.
