---
name: uw-graph
description: Use after scanning (and ideally coverage verification) to emit the rebuild knowledge-graph artifact. Joins the manifest, coverage diff, and layer docs into docs/unwind/rebuild-graph.json for the dashboard.
allowed-tools:
  - Read
  - Glob
  - Bash(mkdir:*, ls:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/**)
  - Write(docs/unwind/**)
---

# Emitting the Rebuild Graph

**Purpose:** Export `docs/unwind/rebuild-graph.json` — the joined knowledge-graph
artifact that the Unwind dashboard renders. It fuses the deterministic scan, the
coverage diff, and the layer documentation into a single graph where every node
carries a `rebuild` block.

> **When do you actually need this skill?** Only to produce the JSON **without
> launching a server** — a static deploy (e.g. the live demo), CI, sharing, or
> diffing the artifact. For interactive viewing you don't need it: `unwind:uw-dashboard`
> regenerates the graph itself before launching. This is an **optional export**, not a
> required pipeline gate.

**Output:** `docs/unwind/rebuild-graph.json`

> **Two graphs — don't confuse them.** `scan-manifest.json` (built by `uw-scan`) is
> the **ground truth** — the file/symbol/import graph that drives seeds, the coverage
> diff, and completeness; the analysis skills read *it*, never this file.
> `rebuild-graph.json` (this skill's output) is a **refreshable projection** of
> manifest + coverage + docs that **only the dashboard reads** — nothing upstream
> reads it back. So it sits at the end of the linear pass (where it's richest), but
> it does **not** drive analysis and is **not** rigidly last: you can build it right
> after `uw-scan` for a structural view (everything `scanned`) and re-run it after any
> phase to refresh. Safe to regenerate anytime.

> **Graceful fallback:** if Node/pnpm or `@unwind/core` are unavailable, or if no
> `scan-manifest.json` exists yet, the script exits non-zero with a clear message.
> Run `uw-scan` (scan) first; the graph is an enhancement, never a hard dependency.

## Inputs (all deterministic)

| Input | Source | Contributes |
|-------|--------|-------------|
| Structure | `docs/unwind/.cache/scan-manifest.json` | file/function/class/table/endpoint nodes + import edges |
| Coverage | `docs/unwind/.cache/coverage/{layer}.json` | `rebuild.coverage` (scanned / documented / verified) |
| Layer docs | `docs/unwind/layers/**/*.md` | `rebuild.priority` (MUST/SHOULD/DON'T) + `rebuild.docRef` |
| Progress overlay (optional) | `docs/unwind/.cache/rebuild-progress.json` | `rebuild.rebuildStatus` (human-maintained, never clobbered) |

The first three are produced by the `uw-scan` and `uw-verify`
skills. Coverage and docs are optional — without them the graph still builds with
every node marked `scanned` / `not-started`.

## Process

### Step 1: Build the graph

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — skip rebuild graph"; exit 0; }
node "$UNWIND_PLUGIN_ROOT/skills/scripts/build-graph.mjs" "$(pwd)"
```

The script:
1. Loads the manifest (the candidate id scheme guarantees nodes join 1:1 with the
   coverage reports).
2. Builds nodes (files + their symbols) and edges (`contains`, `imports`,
   `tested_by` by path convention).
3. Enriches each node's `rebuild` block:
   - `coverage` — covered-by-anchor-id → `verified`, covered-by-name → `documented`,
     missing → `scanned`, DON'T-tagged → `excluded`.
   - `priority` + `docRef` — parsed from the `[MUST]/[SHOULD]/[DON'T]` tag and the
     markdown file the item was documented in.
   - `contractKind` — `db-table` / `api-endpoint` / `event-schema` / `formula`.
   - `rebuildStatus` — merged from `rebuild-progress.json` if present, else derived
     from coverage. **The overlay always wins, so regeneration never erases human
     progress.**
4. Validates with `validateRebuildGraph` (unique ids, no dangling edges, every node
   has an explicit `priority`), then writes the file.

It prints a summary: node / edge / layer counts and a coverage breakdown.

### Step 2: Report

Relay the printed summary (node / edge / layer counts, coverage breakdown) and point
the user at `docs/unwind/rebuild-graph.json`. Since this is the artifact-export path,
mention the likely reason they ran it (static deploy / CI / sharing).

If they actually wanted to *view* the graph, point them at `unwind:uw-dashboard`
(which would have built it for them) rather than treating this as a required step.

> **Pipeline:** scan → analyze → plan → dashboard. `uw-graph` is an **optional
> export** off to the side — the dashboard builds the graph itself.

## The `rebuild` block

```jsonc
{
  "priority": "MUST",            // MUST | SHOULD | DON'T | null
  "contractKind": "db-table",    // db-table | api-endpoint | event-schema | formula | null
  "coverage": "verified",        // scanned | documented | verified | excluded | stale
  "docRef": "docs/unwind/layers/database/tables.md",
  "rebuildStatus": "verified"    // not-started | in-progress | done | verified
}
```

## Re-running

Safe to re-run after every scan or doc change. To record manual rebuild progress,
write `docs/unwind/.cache/rebuild-progress.json` keyed by node id, e.g.:

```json
{ "table:src/db/schema.ts:users": { "rebuildStatus": "in-progress" } }
```
