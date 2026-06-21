---
name: using-unwind
description: Use when starting any reverse engineering task - establishes how to find and use Unwind skills for codebase analysis, service mapping, and documentation
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Using Unwind

## Overview

Unwind provides structured skills for reverse engineering codebases. Produces complete, machine-readable documentation with source links.

Unwind is **hybrid**: a deterministic scanner (`@unwind/core`, tree-sitter) builds
the verifiable ground truth — file inventory, structural symbols, import graph,
and a first-pass layer assignment — and the LLM specialists add the semantic
rebuild documentation (business logic, contracts, MUST/SHOULD/DON'T). Completeness
is then **verified by set arithmetic**, not asserted.

### One-time build

The scanner is built on first use (the skills run `pnpm install && pnpm build`
automatically via `ensure_unwind_core`). To pre-build manually:

```bash
pnpm install && pnpm build
```

Supported languages for symbol extraction: **TypeScript/JavaScript, Python, Rust,
Java, C#**. Other languages still get full file-level coverage (graceful
degradation), and if Node/pnpm is unavailable Unwind falls back to a pure-LLM flow.

## Principles

See `analysis-principles.md`:
- **Completeness**: Document ALL items — the count comes from the scan manifest and is verified
- **Manifest seeding**: Specialists get a candidate checklist; cover every item, exclusions documented not dropped
- **Anchor-id headings**: `### name [MUST] <!-- id: ... -->` so coverage is checked mechanically
- **Machine-readable**: Use actual code, SQL, mermaid - not markdown recreation
- **Link to source**: GitHub links with line numbers where possible
- **No commentary**: Facts only, no speculation or recommendations

## Workflow

```
start     → scan.mjs → scan-manifest.json (ground truth)
        │            → architecture.md (derived + unassigned adjudicated)
        │
unwinding-codebase
        ├── seed-layers.mjs → .cache/seeds/{layer}.json (candidate checklists)
        │
        ├── analyzing-database-layer     → database/        (seeded)
        ├── analyzing-domain-model       → domain-model/    (seeded)
        ├── analyzing-service-layer      → service-layer/   (seeded)
        ├── analyzing-api-layer          → api/             (seeded)
        ├── analyzing-messaging-layer    → messaging/       (if present)
        ├── analyzing-frontend-layer     → frontend/        (if present)
        ├── analyzing-unit-tests         → unit-tests/
        ├── analyzing-integration-tests  → integration-tests/
        └── analyzing-e2e-tests          → e2e-tests/
        │
verify-coverage.mjs → DETERMINISTIC diff (manifest − docs)
        │            → .cache/coverage/{layer}.json + gaps.md (missing items)
        │
completing-layer-documentation → fills gaps.md, deletes it
        │   (loop verify → complete until 100% coverage)
        │
synthesizing-findings       → REBUILD-PLAN.md (strategic rebuild approach)
```

## Skills

### Core Flow

| Skill | Output |
|-------|--------|
| `start` | `architecture.md` |
| `unwinding-codebase` | Orchestrates layer analysis |
| `verifying-layer-documentation` | `gaps.md` per layer (work list) |
| `completing-layer-documentation` | Fills gaps, deletes gaps.md |
| `synthesizing-findings` | `REBUILD-PLAN.md` |
| `emitting-rebuild-graph` | `rebuild-graph.json` (graph + coverage) |
| `unwind-dashboard` | Launches the interactive graph dashboard |
| `refreshing-analysis` | Incremental update — re-analyzes only changed layers |

### Layer Specialists

| Skill | Output |
|-------|--------|
| `analyzing-database-layer` | `database.md` |
| `analyzing-domain-model` | `domain-model.md` |
| `analyzing-service-layer` | `service-layer.md` |
| `analyzing-api-layer` | `api.md` |
| `analyzing-messaging-layer` | `messaging.md` |
| `analyzing-frontend-layer` | `frontend.md` |

### Testing Specialists

| Skill | Output |
|-------|--------|
| `analyzing-unit-tests` | `unit-tests.md` |
| `analyzing-integration-tests` | `integration-tests.md` |
| `analyzing-e2e-tests` | `e2e-tests.md` |

## Output Structure

```
docs/unwind/
├── architecture.md
├── .cache/                            # deterministic intermediates
│   ├── scan-manifest.json            # ground truth (inventory + symbols)
│   ├── meta.json                     # baseline fingerprints + commit (incremental)
│   ├── changes.json                  # detect-changes output (incremental refresh)
│   ├── seeds/{layer}.json            # per-layer candidate checklists
│   └── coverage/{layer}.json         # per-layer coverage reports
├── rebuild-graph.json                # knowledge graph for the dashboard
├── layers/
│   ├── database/
│   │   ├── index.md
│   │   ├── schema.md
│   │   ├── repositories.md
│   │   └── verification.md
│   ├── domain-model/
│   │   ├── index.md
│   │   ├── entities.md
│   │   └── verification.md
│   ├── service-layer/
│   │   ├── index.md
│   │   ├── services.md
│   │   ├── formulas.md
│   │   └── verification.md
│   ├── api/
│   │   ├── index.md
│   │   ├── endpoints.md
│   │   └── verification.md
│   └── [other layers...]
└── REBUILD-PLAN.md
```

Each layer is a folder with `index.md` + section files for incremental writes.

## Quick Start

1. `Use unwind:start` — runs the deterministic scan, derives `architecture.md`
2. Review `docs/unwind/architecture.md`
3. `Use unwind:unwinding-codebase` — seeds specialists, analyzes, verifies coverage
4. `Use unwind:verifying-layer-documentation` — deterministic coverage diff (re-run any time)
5. `Use unwind:synthesizing-findings`
6. `Use unwind:emitting-rebuild-graph` then `unwind:unwind-dashboard` — visualize coverage & contracts

**After code changes:** `Use unwind:refreshing-analysis` — fingerprints detect
what moved and only the affected layers are re-analyzed; changed contracts are
flagged `stale` / `needs-recheck` in the graph.

**Note:** Step 4 (verification) is a deterministic `manifest − docs` diff and is
integrated into `unwinding-codebase`; run it standalone to re-verify existing
documentation at any time.

## Refresh Mode

Re-run any skill to update documentation. Changes highlighted in `## Changes Since Last Review` section.
