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

**Reads:** `docs/unwind/rebuild-graph.json` (produced by `emitting-rebuild-graph`).

> **Graceful fallback:** if Node/pnpm or `@unwind/core` are unavailable, or no
> `rebuild-graph.json` exists, this skill reports what's missing and stops cleanly.
> Generate the graph first with `unwind:emitting-rebuild-graph`.

## When to Use

- After scanning + emitting the rebuild graph, to review coverage and gaps visually.
- To browse the contract inventory and jump to source.
- To track rebuild progress across layers.

## Process

### Step 0: Preconditions

```bash
source "$(dirname "$0")/../scripts/_resolve-plugin-root.sh"
ensure_unwind_core || { echo "core unavailable — cannot run dashboard"; exit 0; }

if [ ! -f "$(pwd)/docs/unwind/rebuild-graph.json" ]; then
  echo "No rebuild-graph.json — run unwind:emitting-rebuild-graph first." >&2
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
