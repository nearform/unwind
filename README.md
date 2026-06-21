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

## Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UNWIND WORKFLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: DISCOVERY                                                          │
│  ┌──────────────────────────┐                                               │
│  │         start            │ ──► architecture.md                           │
│  └────────────┬─────────────┘     (layers, entry points, repo info)         │
│               │                                                              │
│               ▼                                                              │
│  PHASE 2: LAYER ANALYSIS                                                     │
│  ┌──────────────────────────┐                                               │
│  │   unwinding-codebase     │ ──► Dispatches layer specialists              │
│  └────────────┬─────────────┘                                               │
│               │                                                              │
│       ┌───────┴───────┬───────────┬───────────┬───────────┐                │
│       ▼               ▼           ▼           ▼           ▼                │
│  ┌─────────┐    ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐         │
│  │database/│    │ domain-  │ │service- │ │  api/   │ │frontend/ │         │
│  │         │    │ model/   │ │ layer/  │ │         │ │          │         │
│  └────┬────┘    └────┬─────┘ └────┬────┘ └────┬────┘ └────┬─────┘         │
│       │              │            │           │           │                 │
│       └──────────────┴────────────┴───────────┴───────────┘                │
│                              │                                              │
│                              ▼                                              │
│  PHASE 3: GAP DETECTION                                                      │
│  ┌───────────────────────────────────────────────────────────┐             │
│  │           verifying-layer-documentation                    │             │
│  │   (Parallel agents compare docs to source)                 │             │
│  └─────────────────────────────┬─────────────────────────────┘             │
│                                │                                            │
│                                ▼                                            │
│                         ┌──────────┐                                        │
│                         │ gaps.md  │  (per layer - work list only)          │
│                         └────┬─────┘                                        │
│                              │                                              │
│                              ▼                                              │
│  PHASE 4: GAP COMPLETION                                                     │
│  ┌───────────────────────────────────────────────────────────┐             │
│  │           completing-layer-documentation                   │             │
│  │   (Parallel agents fix all gaps, delete gaps.md)          │             │
│  └─────────────────────────────┬─────────────────────────────┘             │
│                                │                                            │
│                                ▼                                            │
│  PHASE 5: SYNTHESIS                                                          │
│  ┌──────────────────────────────────────────────────────────┐              │
│  │              synthesizing-findings                        │              │
│  │   (Generates strategic REBUILD-PLAN.md)                  │              │
│  └──────────────────────────────────────────────────────────┘              │
│                                │                                            │
│                                ▼                                            │
│                    ┌──────────────────────┐                                │
│                    │   REBUILD-PLAN.md    │                                │
│                    │  (Strategic rebuild) │                                │
│                    └──────────────────────┘                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phases Explained

### Phase 1: Discovery (scan-first)
Runs the deterministic scanner to build `scan-manifest.json` — file inventory,
per-file structural symbols, import graph, repository info (for GitHub links), and
a first-pass rebuild-layer assignment. `architecture.md` is **derived** from this;
the Explore subagent only adds narrative and adjudicates files the scanner left
`unassigned`. Falls back to pure-LLM discovery if the scanner is unavailable.

### Phase 2: Layer Analysis (seeded)
`seed-layers.mjs` emits a candidate checklist per layer from the manifest. Each
specialist is dispatched **with its seed list** and must document every item using
anchor-id headings (`### name [MUST] <!-- id: ... -->`), then runs in dependency
order:
1. Database (no dependencies)
2. Domain Model (needs database)
3. Service Layer (needs domain)
4. API + Messaging (parallel, need services)
5. Frontend (needs API)
6. Tests (parallel, no layer dependencies)

Each layer writes to a folder with incremental files to avoid token limits.

### Phase 3: Gap Detection (deterministic)
`verify-coverage.mjs` diffs the manifest's candidate set against the documented
anchor ids — pure set arithmetic, reproducible. Missing items (in source, not in
docs) are written to `gaps.md`; "extra" documented items are flagged for review.
This replaces the old subjective LLM comparison.

### Phase 4: Gap Completion
Reads `gaps.md` work lists and adds all missing documentation. Deletes `gaps.md` when complete.

### Phase 5: Synthesis
Aggregates all layer documentation into final deliverables.

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
| `start` | Initial codebase exploration | `architecture.md` |
| `unwinding-codebase` | Orchestrates all phases | Dispatches specialists |
| `verifying-layer-documentation` | Detects gaps in docs | `gaps.md` per layer |
| `completing-layer-documentation` | Fixes all gaps | Updated layer files |
| `synthesizing-findings` | Generates strategic rebuild plan | `REBUILD-PLAN.md` |

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
├── .cache/                            # Deterministic artifacts
│   ├── scan-manifest.json            # Ground truth: inventory, symbols, import graph
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
