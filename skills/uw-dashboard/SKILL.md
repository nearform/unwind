---
name: uw-dashboard
description: Use to visually explore the rebuild knowledge graph. Builds and launches the Unwind dashboard (React + React Flow + ELK) pointed at docs/unwind/rebuild-graph.json with coverage, priority, and contract views.
allowed-tools:
  - Read
  - Glob
  - Bash(mkdir:*, ls:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/**)
---

# Unwind Dashboard

**Purpose:** Launch an interactive dashboard over the rebuild knowledge graph. It
visualizes the dependency-ordered layers, per-node coverage, MUST/SHOULD/DON'T
priorities, and the contract inventory (tables, endpoints, …) — the rebuild
mission view, not a learning tour.

**Reads:** `docs/unwind/rebuild-graph.json` — auto-generated from the scan manifest
if it doesn't exist yet, so the dashboard can be opened **any time after
`unwind:uw-scan`**.

> **Graceful fallback:** if Node/pnpm or `@unwind/core` are unavailable, this skill
> reports what's missing and stops cleanly. If there's no scan yet, run
> `unwind:uw-scan` first.

## When to Use

- **Right after `unwind:uw-scan`** — visualize the scanned structure (everything `scanned`).
- After analysis — review per-layer coverage, MUST/SHOULD/DON'T, and gaps visually.
- To browse the contract inventory and jump to source, or track rebuild progress.

## Process

### Step 0: Preconditions

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — cannot run dashboard"; exit 0; }

# The dashboard renders docs/unwind/rebuild-graph.json. This skill is the
# visualization phase: it (re)builds the graph from the current scan + docs so the
# view is never stale, then launches. You do NOT need to run unwind:uw-graph first —
# that skill exists only to export the JSON artifact without a server (static deploy,
# CI, sharing). Always regenerate here when a manifest exists:
#   - straight after the scan (manifest only) → graph of the scanned structure
#   - after analysis → graph also carries coverage + MUST/SHOULD/DON'T priorities
#   - re-run anytime after a doc/code change → refreshed coverage + priorities
# build-graph preserves the human progress overlay (rebuild-progress.json), so a
# rebuild never clobbers tracked rebuild status.
if [ -f "$(pwd)/docs/unwind/.cache/scan-manifest.json" ]; then
  echo "Generating rebuild-graph.json from the current scan + docs…" >&2
  node "$UNWIND_PLUGIN_ROOT/skills/scripts/build-graph.mjs" "$(pwd)"
elif [ ! -f "$(pwd)/docs/unwind/rebuild-graph.json" ]; then
  echo "No scan found — run unwind:uw-scan first." >&2
  exit 0
fi
```

### Step 1: Install + build dashboard deps (first run only)

```bash
( cd "$UNWIND_PLUGIN_ROOT" && pnpm install )
```

### Step 2: Launch the dashboard

The dev server resolves the graph from the current project. Point it at the project
directory (the one containing `docs/unwind`) via `UNWIND_GRAPH_DIR`:

```bash
UNWIND_GRAPH_DIR="$(pwd)" pnpm --filter @unwind/dashboard dev
```

**Run this in the background** (it's a long-lived server — a foreground run would
block the session). The Vite config sets `open: true`, so it binds to
`127.0.0.1:5174` and pops the browser automatically once ready. The dev server serves
`docs/unwind/rebuild-graph.json` and a sandboxed `/file-content.json` endpoint
(constrained to files inside the project) that powers the in-app code viewer.

To produce a static build instead (no live source viewer):

```bash
pnpm --filter @unwind/dashboard build
```

### Step 3: Report — pipeline complete

Tell the user the URL (`http://127.0.0.1:5174`) and summarize the views available.

This is the **end of the pipeline** (scan → analyze → plan → **dashboard ✓**).
No "next phase" to gate — instead tell the user how to keep it current:
- After any code or doc change, just re-run `unwind:uw-dashboard` — it rebuilds the
  graph from the current scan + docs before launching, so the view is never stale.
- For an incremental re-analysis of what changed, run `unwind:uw-refresh`.
- Only need the raw `rebuild-graph.json` (deploy / CI / sharing)? Run `unwind:uw-graph`.

## Views

- **Graph** — React Flow + ELK layered layout. Nodes are colored by type with a
  coverage dot and priority badge; click to inspect the full `rebuild` block, jump
  to connections, open source, or focus the 1-hop neighborhood. Filter by priority,
  coverage, rebuild status, node type, contract kind, and layer; search by name/path.
- **Coverage** — per-layer verified / documented / scanned bars.
- **Priorities** — MUST / SHOULD / DON'T counts per layer.
- **Contracts** — filterable table of every contract node (tables, endpoints, …)
  with kind, priority, coverage, rebuild status, and a source link; click a row to
  focus it in the graph.
- **Rebuild** — appears only after `unwind:uw-build`. Shows the "build assets": the
  source→target file mapping per node and the headline completeness over `[MUST]`
  (from `rebuild-state.json` + `rebuild-verification-graph.json`, folded into the
  graph by `build-graph.mjs`). Click a row to focus the source node in the graph.

## Notes

- The dashboard is a consumer of `rebuild-graph.json` only; it never writes to the
  project. Re-run `uw-graph` to refresh the data, then reload.
- Large repos: the graph view caps rendered nodes (use search/filters to narrow);
  the Coverage/Priorities/Contracts views always aggregate the full graph.
