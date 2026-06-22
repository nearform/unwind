---
name: unwind-dashboard
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
`unwind:start`**.

> **Graceful fallback:** if Node/pnpm or `@unwind/core` are unavailable, this skill
> reports what's missing and stops cleanly. If there's no scan yet, run
> `unwind:start` first.

## When to Use

- **Right after `unwind:start`** — visualize the scanned structure (everything `scanned`).
- After analysis — review per-layer coverage, MUST/SHOULD/DON'T, and gaps visually.
- To browse the contract inventory and jump to source, or track rebuild progress.

## Process

### Step 0: Preconditions

```bash
source "$(dirname "$0")/../scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — cannot run dashboard"; exit 0; }

# The dashboard needs docs/unwind/rebuild-graph.json. Build it on demand so the
# dashboard can be opened any time after unwind:start:
#   - straight after the scan (manifest only) → graph of the scanned structure
#   - after analysis → graph also carries coverage + MUST/SHOULD/DON'T priorities
if [ ! -f "$(pwd)/docs/unwind/rebuild-graph.json" ]; then
  if [ -f "$(pwd)/docs/unwind/.cache/scan-manifest.json" ]; then
    echo "No rebuild-graph.json yet — generating it from the scan…" >&2
    node "$UNWIND_PLUGIN_ROOT/skills/scripts/build-graph.mjs" "$(pwd)"
  else
    echo "No scan found — run unwind:start first." >&2
    exit 0
  fi
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

It binds to `127.0.0.1:5174` and opens the browser. The dev server serves
`docs/unwind/rebuild-graph.json` and a sandboxed `/file-content.json` endpoint
(constrained to files inside the project) that powers the in-app code viewer.

To produce a static build instead (no live source viewer):

```bash
pnpm --filter @unwind/dashboard build
```

### Step 3: Report

Tell the user the URL (`http://127.0.0.1:5174`) and summarize the views available.

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

## Notes

- The dashboard is a consumer of `rebuild-graph.json` only; it never writes to the
  project. Re-run `emitting-rebuild-graph` to refresh the data, then reload.
- Large repos: the graph view caps rendered nodes (use search/filters to narrow);
  the Coverage/Priorities/Contracts views always aggregate the full graph.
