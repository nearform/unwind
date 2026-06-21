---
name: emitting-rebuild-graph
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

**Purpose:** Produce `docs/unwind/rebuild-graph.json` — the joined knowledge-graph
artifact that the Unwind dashboard renders. It fuses the deterministic scan, the
coverage diff, and the layer documentation into a single graph where every node
carries a `rebuild` block.

**Output:** `docs/unwind/rebuild-graph.json`

> **Graceful fallback:** if Node/pnpm or `@unwind/core` are unavailable, or if no
> `scan-manifest.json` exists yet, the script exits non-zero with a clear message.
> Run `start` (scan) first; the graph is an enhancement, never a hard dependency.

## Inputs (all deterministic)

| Input | Source | Contributes |
|-------|--------|-------------|
| Structure | `docs/unwind/.cache/scan-manifest.json` | file/function/class/table/endpoint nodes + import edges |
| Coverage | `docs/unwind/.cache/coverage/{layer}.json` | `rebuild.coverage` (scanned / documented / verified) |
| Layer docs | `docs/unwind/layers/**/*.md` | `rebuild.priority` (MUST/SHOULD/DON'T) + `rebuild.docRef` |
| Progress overlay (optional) | `docs/unwind/.cache/rebuild-progress.json` | `rebuild.rebuildStatus` (human-maintained, never clobbered) |

The first three are produced by the `start` and `verifying-layer-documentation`
skills. Coverage and docs are optional — without them the graph still builds with
every node marked `scanned` / `not-started`.

## Process

### Step 1: Build the graph

```bash
source "$(dirname "$0")/../scripts/_resolve-plugin-root.sh"
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

Relay the printed summary and point the user at the artifact. Offer to launch the
dashboard next with `unwind:unwind-dashboard`.

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
