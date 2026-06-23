---
name: uw-help
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
uw-start  → entry point: orient, check prereqs, drive the pipeline
        │
uw-scan   → scan.mjs → scan-manifest.json (ground truth)
        │            → architecture.md (derived + unassigned adjudicated)
        │
uw-analyze
        ├── seed-layers.mjs → .cache/seeds/{layer}.json (candidate checklists)
        │
        ├── uw-analyze-database     → database/        (seeded)
        ├── uw-analyze-domain       → domain-model/    (seeded)
        ├── uw-analyze-service      → service-layer/   (seeded)
        ├── uw-analyze-api          → api/             (seeded)
        ├── uw-analyze-messaging    → messaging/       (if present)
        ├── uw-analyze-frontend     → frontend/        (if present)
        ├── uw-analyze-unit-tests         → unit-tests/
        ├── uw-analyze-integration-tests  → integration-tests/
        ├── uw-analyze-e2e-tests          → e2e-tests/
        └── uw-analyze-infrastructure     → infrastructure/  (seeded)
        │
verify-coverage.mjs → DETERMINISTIC diff (manifest − docs)
        │            → .cache/coverage/{layer}.json + gaps.md (missing items)
        │
uw-complete → fills gaps.md, deletes it
        │   (loop verify → complete until 100% coverage)
        │
uw-plan       → REBUILD-PLAN.md (strategic rebuild approach)
```

## Skills

### Core Flow

| Skill | Output |
|-------|--------|
| `uw-start` | **Entry point** — orients, checks prereqs, drives the pipeline |
| `uw-scan` | `architecture.md` |
| `uw-analyze` | Orchestrates layer analysis |
| `uw-verify` | `gaps.md` per layer (work list) |
| `uw-complete` | Fills gaps, deletes gaps.md |
| `uw-plan` | `REBUILD-PLAN.md` |
| `uw-graph` | `rebuild-graph.json` (graph + coverage) |
| `uw-dashboard` | Launches the interactive graph dashboard |
| `uw-refresh` | Incremental update — re-analyzes only changed layers |

### Layer Specialists

| Skill | Output |
|-------|--------|
| `uw-analyze-database` | `database.md` |
| `uw-analyze-domain` | `domain-model.md` |
| `uw-analyze-service` | `service-layer.md` |
| `uw-analyze-api` | `api.md` |
| `uw-analyze-messaging` | `messaging.md` |
| `uw-analyze-frontend` | `frontend.md` |
| `uw-analyze-infrastructure` | `infrastructure/` |

### Testing Specialists

| Skill | Output |
|-------|--------|
| `uw-analyze-unit-tests` | `unit-tests.md` |
| `uw-analyze-integration-tests` | `integration-tests.md` |
| `uw-analyze-e2e-tests` | `e2e-tests.md` |

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

**New here? Just `Use unwind:uw-start`** — it orients you, checks prerequisites, and
drives the whole pipeline with a checkpoint at each phase. The manual sequence is:

1. `Use unwind:uw-scan` — runs the deterministic scan, derives `architecture.md`
2. Review `docs/unwind/architecture.md`
3. `Use unwind:uw-analyze` — seeds specialists, analyzes, verifies coverage
4. `Use unwind:uw-verify` — deterministic coverage diff (re-run any time)
5. `Use unwind:uw-plan`
6. `Use unwind:uw-dashboard` — builds the graph and launches the viewer
   (`unwind:uw-graph` is an optional raw-artifact export)

**After code changes:** `Use unwind:uw-refresh` — fingerprints detect
what moved and only the affected layers are re-analyzed; changed contracts are
flagged `stale` / `needs-recheck` in the graph.

**Note:** Step 4 (verification) is a deterministic `manifest − docs` diff and is
integrated into `uw-analyze`; run it standalone to re-verify existing
documentation at any time.

## Refresh Mode

Re-run any skill to update documentation. Changes highlighted in `## Changes Since Last Review` section.
