# Unwind

Skills library for reverse engineering codebases. Produces complete, machine-readable documentation and phased rebuild plans to reliably re-build the service or application in a new technology or modernised framework.

## Purpose

Generate documentation that enables an AI agent to rebuild your system in a different language or framework while maintaining:
- External API contract compatibility
- Business logic accuracy
- Data model integrity

Unwind is **hybrid**: a deterministic scanner (`@unwind/core`, built on
tree-sitter) produces the verifiable ground truth — file inventory, structural
symbols, import graph, and a first-pass layer assignment — and LLM specialists add
the semantic rebuild documentation. Completeness is then **verified by set
arithmetic** (`scan − docs`), not asserted. Symbol extraction supports
TypeScript/JavaScript, Python, Rust, Java, and C#; other languages get file-level
coverage, and if Node/pnpm is unavailable Unwind falls back to a pure-LLM flow.

## Quick Start

### Install

```
/plugin install https://github.com/cliftonc/unwind
```
Restart Claude Code after installation.

### Use
```
1. Use unwind:start              # deterministic scan → architecture.md
2. Review docs/unwind/architecture.md
3. Use unwind:unwinding-codebase # seed → analyze → verify coverage → complete
4. Use unwind:synthesizing-findings
```

The first run builds the scanner automatically (`pnpm install && pnpm build` via
`ensure_unwind_core`). It needs Node + pnpm; without them, Unwind falls back to a
pure-LLM flow.

**Output:**
- `docs/unwind/REBUILD-PLAN.md` - Strategic rebuild approach
- `docs/unwind/layers/*/` - Detailed layer analysis (folder per layer)
- `docs/unwind/.cache/` - Deterministic artifacts: `scan-manifest.json` (ground truth), `seeds/` (per-layer checklists), `coverage/` (per-layer coverage reports)

### Example Output

See a complete example from the [RealWorld Go API](https://github.com/cliftonc/golang-gin-realworld-example-app):
- [REBUILD-PLAN.md](https://github.com/cliftonc/golang-gin-realworld-example-app/blob/main/docs/unwind/REBUILD-PLAN.md)
- [architecture.md](https://github.com/cliftonc/golang-gin-realworld-example-app/blob/main/docs/unwind/architecture.md)
- [Layer documentation](https://github.com/cliftonc/golang-gin-realworld-example-app/tree/main/docs/unwind/layers)

---

### Updating

```
/plugin uninstall unwind
/plugin install https://github.com/cliftonc/unwind
```

---

## How it works

Unwind interleaves **deterministic scripts** (which own the verifiable facts) with
**LLM sub-agents** (which add semantic judgment). The deterministic layer is what
makes "did we document everything?" a *checkable* question instead of a hopeful one.

![Unwind pipeline](docs/pipeline.svg)

### Step by step

| # | Step | Kind | What it does |
|---|------|------|--------------|
| 1 | `scan.mjs` | **deterministic** | Walks `git ls-files`, runs tree-sitter to extract symbols (functions, classes, **tables, endpoints**), resolves the import graph, and assigns every file a rebuild layer → **`scan-manifest.json`**, the ground truth. |
| 2 | `seed-layers.mjs` | **deterministic** | Turns the manifest into a per-layer **candidate checklist** (`seeds/{layer}.json`) — the exact set of items each specialist must cover. |
| 3 | layer specialists | LLM | Sub-agents document each layer (database → domain → service → api/messaging → frontend → tests), seeded with their checklist, writing tagged docs with `### name [MUST] <!-- id: ... -->` anchor headings. |
| 4 | `verify-coverage.mjs` | **deterministic** | The key move: **`manifest − docs`** by set arithmetic. Anything in the scan but not in the docs is a gap — reported with names and line numbers in `gaps.md`. Reproducible byte-for-byte. |
| 5 | `completing-layer-documentation` | LLM | Fills the `gaps.md` work list. Loops 4 ⇄ 5 until coverage is 100% (or items are explicitly excluded). |
| 6 | `synthesizing-findings` | LLM | Produces the strategic **`REBUILD-PLAN.md`** (re-use decisions, phasing, validation). |
| 7 | `build-graph.mjs` | **deterministic** | Joins manifest + coverage + docs into **`rebuild-graph.json`** — nodes carry MUST/SHOULD/DON'T, coverage state, and rebuild status — and powers the dashboard. |
| ↻ | `detect-changes.mjs` | **deterministic** | After code changes, structural fingerprints find exactly what moved so only the **affected layers** are re-analyzed; changed contracts are flagged `stale` / `needs-recheck`. |

**Why it matters:** completeness ("all 42 tables") used to be the LLM's word for it.
Now the scanner finds the 42, the specialist documents them, and step 4 *proves*
none are missing. Languages with tree-sitter symbol extraction: TypeScript/JavaScript,
Python, Rust, Java, C#. Other languages get file-level coverage; with no Node/pnpm,
Unwind falls back to a pure-LLM flow.

## Visualize the graph

After a run, explore the result interactively:

```
Use unwind:emitting-rebuild-graph   # build docs/unwind/rebuild-graph.json
Use unwind:unwind-dashboard         # launch the React + React Flow dashboard
```

The dashboard (`http://127.0.0.1:5174`) shows the dependency-ordered layers, a
per-layer **coverage meter**, the **MUST/SHOULD/DON'T** breakdown, and a filterable
**contract inventory** (every table, endpoint, …) with source links and rebuild
status. To point it at any project directly:

```
UNWIND_GRAPH_DIR="/path/to/project" pnpm --filter @unwind/dashboard dev
```

## Keeping it fresh (incremental)

```
Use unwind:refreshing-analysis      # after code changes
```

`scan.mjs` records a fingerprint baseline (`meta.json`). `detect-changes.mjs` diffs
a fresh scan against it and classifies every file as `structural` (signature moved),
`cosmetic` (body/comments only — docs stay valid), `added`, `removed`, or
`unchanged`. Only the layers in `affectedLayers` are re-analyzed, and documented
items whose source changed structurally are marked `stale` in the graph — so the
unwind spec stays accurate across a long migration instead of going out of date.

---

## Principles

All analysis follows these principles (see `skills/analysis-principles.md`):

| Principle | Description |
|-----------|-------------|
| **Completeness** | Document ALL items - counts come from the scan manifest and are verified |
| **Manifest seeding** | Specialists receive a candidate checklist; cover every item, exclusions documented not dropped |
| **Anchor-id headings** | `### name [MUST] <!-- id: ... -->` so coverage is checked mechanically |
| **Machine-readable** | Actual code, SQL, mermaid - not prose summaries |
| **Link to source** | Uses repo info for GitHub links, or local paths |
| **No commentary** | Facts only, no speculation or recommendations |
| **Rebuild categorization** | Tag items as MUST/SHOULD/DON'T keep |
| **Incremental writes** | Write each section immediately, don't buffer |
| **Migrations: current state** | Document final schema, not migration history |

## Skills

### Core Flow

| Skill | Purpose | Output |
|-------|---------|--------|
| `start` | Deterministic scan + discovery | `architecture.md` (+ `scan-manifest.json`) |
| `unwinding-codebase` | Orchestrates seed → analyze → verify → complete | Dispatches specialists |
| `verifying-layer-documentation` | Deterministic `manifest − docs` diff | `gaps.md` per layer |
| `completing-layer-documentation` | Fixes all gaps | Updated layer files |
| `synthesizing-findings` | Generates strategic rebuild plan | `REBUILD-PLAN.md` |
| `emitting-rebuild-graph` | Joins manifest + coverage + docs | `rebuild-graph.json` |
| `unwind-dashboard` | Launches the interactive graph UI | dashboard at `:5174` |
| `refreshing-analysis` | Incremental update (only changed layers) | refreshed docs + graph |

### Layer Specialists

| Skill | Analyzes | Key Requirements |
|-------|----------|------------------|
| `analyzing-database-layer` | Schema, repositories | All tables, JSONB schemas, indexes |
| `analyzing-domain-model` | Entities, validation | Constraint tables, permission matrix |
| `analyzing-service-layer` | Services, calculations | Formulas with source refs, edge cases |
| `analyzing-api-layer` | Endpoints, auth, contracts | OpenAPI/TSRest specs, route inventory |
| `analyzing-messaging-layer` | Events, queues | AsyncAPI specs, event schemas |
| `analyzing-frontend-layer` | Components, state | User flows (WHAT), not implementation (HOW) |

### Testing Specialists

| Skill | Analyzes |
|-------|----------|
| `analyzing-unit-tests` | Unit test coverage and patterns |
| `analyzing-integration-tests` | Integration test infrastructure |
| `analyzing-e2e-tests` | E2E tests and page objects |

## Output Structure

```
docs/unwind/
├── architecture.md                    # Layer detection, tech stack, repo info (derived from scan)
├── rebuild-graph.json                 # Knowledge graph for the dashboard
├── .cache/                            # Deterministic artifacts
│   ├── scan-manifest.json            # Ground truth: inventory, symbols, contracts, import graph
│   ├── meta.json                     # Fingerprint baseline (incremental refresh)
│   ├── changes.json                  # detect-changes output (incremental refresh)
│   ├── seeds/{layer}.json            # Per-layer candidate checklists
│   └── coverage/{layer}.json         # Per-layer coverage reports
├── layers/
│   ├── database/
│   │   ├── index.md                   # Overview, links to sections
│   │   ├── schema.md                  # All tables, fields
│   │   ├── repositories.md            # Data access patterns
│   │   └── jsonb-schemas.md           # Complex field structures
│   ├── domain-model/
│   │   ├── index.md
│   │   ├── entities.md
│   │   ├── enums.md
│   │   └── validation.md
│   ├── service-layer/
│   │   ├── index.md
│   │   ├── services.md
│   │   ├── formulas.md                # Business calculations [MUST]
│   │   └── dtos.md
│   ├── api/
│   │   ├── index.md
│   │   ├── endpoints.md
│   │   ├── contracts.md               # OpenAPI/TSRest [CRITICAL]
│   │   └── auth.md
│   ├── frontend/
│   │   ├── index.md
│   │   ├── pages.md                   # User flows, not React code
│   │   └── state.md
│   └── [test layers...]
└── REBUILD-PLAN.md                    # Strategic rebuild approach
```

## Rebuild Plan

The `REBUILD-PLAN.md` provides:

1. **External Contract Compatibility** - OpenAPI/AsyncAPI specs that MUST be preserved
2. **Phased Approach** - Database → Domain → Services → API → Frontend
3. **Validation Checkpoints** - Concrete tests for each phase
4. **Migration Strategy** - Data migration and parallel running approach

## Rebuild Categorization

Each documented item is tagged:

| Tag | Meaning | Action |
|-----|---------|--------|
| **MUST** | Essential for comparable functionality | Implement exactly |
| **SHOULD** | Valuable but implementation-flexible | Preserve intent |
| **DON'T** | Tech-stack specific | Omit from rebuild |

## License

MIT
