---
name: uw-analyze
description: Use after unwind:uw-scan to orchestrate layer-by-layer analysis using specialist subagents
uses-skills:
  - unwind:uw-analyze-database
  - unwind:uw-analyze-domain
  - unwind:uw-analyze-service
  - unwind:uw-analyze-api
  - unwind:uw-analyze-messaging
  - unwind:uw-analyze-frontend
  - unwind:uw-analyze-unit-tests
  - unwind:uw-analyze-integration-tests
  - unwind:uw-analyze-e2e-tests
  - unwind:uw-verify
  - unwind:uw-complete
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

# Unwinding Codebase

**Requires:** `docs/unwind/architecture.md` + `docs/unwind/.cache/scan-manifest.json` (from `uw-scan`)
**Produces:** `docs/unwind/layers/*/` folders via subagents (each with index.md + section files)

**Principles:** See `analysis-principles.md` - completeness, machine-readable, link to source, no commentary, **incremental writes**, **anchor-id headings**, **manifest seeding**.

> **Hybrid flow:** layer specialists are *seeded* with the deterministic candidate
> list the scanner found (so completeness is a checklist, not a guess), and
> verification is a deterministic `manifest − docs` diff (not a subjective LLM
> comparison). If `@unwind/core`/the manifest is unavailable, fall back to the
> legacy unseeded dispatch + LLM gap detection — the flow still works.

## Process

### Step 0: Generate Layer Seeds

If `docs/unwind/.cache/scan-manifest.json` exists, emit per-layer candidate lists:

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || echo "core unavailable — legacy unseeded dispatch"
node "$UNWIND_PLUGIN_ROOT/skills/scripts/seed-layers.mjs" "$(pwd)"
```

This writes `docs/unwind/.cache/seeds/{layer}.json` — each is
`{layer, count, items:[{id, kind, name, file, startLine, endLine, link}]}`. These
are the items every specialist **must** document. If the manifest is missing,
skip this step and dispatch specialists the legacy way (no seed paste).

### Step 1: Parse Architecture Document

1. Read `docs/unwind/architecture.md`
2. Extract `repository.link_format` for source linking
3. Extract YAML `layers` block
4. Build dependency graph
5. Skip layers with `status: not_detected`

### Step 2: Execution Phases

```
Phase 1: database (no dependencies)
Phase 2: domain_model (needs database)
Phase 3: service_layer (needs domain_model)
Phase 4: api, messaging (parallel - need service_layer)
Phase 5: frontend (optional - needs api)
Phase 6: unit_tests, integration_tests, e2e_tests (parallel - no layer dependencies)
```

### Step 3: Dispatch Subagents

For each layer, dispatch the specialist **with its seed file pasted in**
(read `docs/unwind/.cache/seeds/{layer}.json` first):

```
Task(subagent_type="general-purpose")
  description: "Analyze [layer] layer"
  prompt: |
    Use unwind:uw-analyze-[layer] to analyze this codebase layer.

    Entry points from architecture.md:
    [entry_points]

    ## Candidate items (deterministic scan) — your completeness checklist
    [paste the contents of docs/unwind/.cache/seeds/[layer].json]

    These [count] items were found deterministically by the scanner. You MUST
    document EVERY one. Use the anchor-id heading format so coverage can be
    verified mechanically:

        ### <name> [MUST|SHOULD|DON'T] <!-- id: <id> -->

    (the `id` is the item's `id` from the seed). To omit an item, document it
    under an `## Excluded` section with a one-line reason — NEVER silently drop
    it. You MAY ADD items the scanner missed (e.g. dynamically-registered routes).

    SOURCE LINKING - Use this format for all source references:
    [link_format from architecture.md]

    Replace {path}, {start}, {end} with actual values.
    Example: [UserService.ts]([link_format with path=src/services/UserService.ts, start=45, end=67])
    (the seed items already include a ready-made `link` field.)

    IMPORTANT: Write incrementally to folder structure.
    1. Create docs/unwind/layers/[layer]/ directory first
    2. Write initial index.md with skeleton sections
    3. Analyze each section and write its .md file IMMEDIATELY after analyzing
    4. Update index.md after each section file is written
    5. Do NOT buffer all content for a single write at the end

    Output folder: docs/unwind/layers/[layer]/
    - index.md (overview + links to sections)
    - section files per the skill spec

    Follow analysis-principles.md: completeness, machine-readable, link to
    source, no commentary, anchor-id headings.
```

> **Legacy (no manifest):** if seeds are unavailable, omit the "Candidate items"
> block and the anchor-id requirement; dispatch as an unseeded discovery task.

**Parallel rules:**
- Same phase, no cross-dependencies → parallel
- Wait for phase N before phase N+1

### Step 4: Testing Analysis

After application layers complete, dispatch testing specialists in parallel:

```
- uw-analyze-unit-tests → unit-tests/ folder
- uw-analyze-integration-tests → integration-tests/ folder
- uw-analyze-e2e-tests → e2e-tests/ folder
```

Testing analysis can reference application layer docs for coverage mapping.

### Step 5: Gap Detection (Deterministic)

After all layer analysis completes, run the coverage verifier. This is a
**deterministic `manifest − docs` diff** — not an LLM comparison:

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/verify-coverage.mjs" "$(pwd)"
```

It writes `docs/unwind/.cache/coverage/{layer}.json` (covered/total/pct, matched
by id vs fuzzy) and, for any layer with missing items, a
`docs/unwind/layers/{layer}/gaps.md` work list — already in the format
`uw-complete` consumes (name, type, location, id). The stderr
table shows per-layer coverage at a glance.

> **Legacy (no manifest):** dispatch `unwind:uw-verify`
> subagents to compare docs against source and emit gaps.md the old way.

### Step 6: Gap Completion Phase

For each layer with a `gaps.md`, dispatch completion agents IN PARALLEL:

```
For each layer with gaps.md:
  Task(subagent_type="general-purpose")
    description: "Complete [layer] documentation gaps"
    prompt: |
      Use unwind:uw-complete to fix gaps in [layer].

      Read docs/unwind/layers/[layer]/gaps.md for the work list.

      For each missing item:
      1. Read source at specified location (the gap lists file:start-end)
      2. Add documentation to the correct section file using the anchor-id
         heading format: ### <name> [MUST|SHOULD|DON'T] <!-- id: <id> -->
         (use the gap's Id verbatim so re-verification matches)
      3. If the item should NOT be in the rebuild, move it to an ## Excluded
         section with a one-line reason instead of documenting it.

      Delete gaps.md when complete.
```

**Completion runs in parallel** - no dependencies between layers.

### Step 7: Verify → Complete Loop

Re-run `verify-coverage.mjs`. Repeat Steps 5-6 until every layer reports **100%
coverage** (or the only remaining "missing" items are justified entries under an
`## Excluded` section). Because the diff is deterministic, this loop converges
and is reproducible.

### Step 8: Handoff — continue or pause?

When all layers reach full coverage, the **analyze** phase is done: layer docs are
written and deterministically verified.

**Use AskUserQuestion** to ask whether to move on:
- **Continue to planning** *(recommended)* — generate the strategic `REBUILD-PLAN.md`.
- **Pause here** — stop after analysis.

Act on the choice in the same turn:
- **Continue** → invoke `unwind:uw-plan`.
- **Pause** → tell them how to resume: *"Run `unwind:uw-plan` (type `/uw-plan`) when ready."*

> **Pipeline:** scan → **analyze ✓** → plan → graph → dashboard. Each phase is a
> separate skill; the graph/dashboard are NOT produced by analysis or planning.

## Execution Example

```yaml
layers:
  database: { status: detected, dependencies: [] }
  domain_model: { status: detected, dependencies: [database] }
  service_layer: { status: detected, dependencies: [domain_model] }
  api: { status: detected, dependencies: [service_layer] }
  messaging: { status: not_detected }
  frontend: { status: detected, dependencies: [api] }
```

Execution:
0. **Seeds**: `seed-layers.mjs` → `.cache/seeds/{layer}.json` (candidate checklists)
1. Phase 1: `uw-analyze-database` (seeded)
2. Phase 2: `uw-analyze-domain` (seeded)
3. Phase 3: `uw-analyze-service` (seeded)
4. Phase 4: `uw-analyze-api` (messaging skipped) (seeded)
5. Phase 5: `uw-analyze-frontend` (seeded)
6. Phase 6: `uw-analyze-unit-tests`, `uw-analyze-integration-tests`, `uw-analyze-e2e-tests` (parallel, seeded)
7. **Gap Detection (deterministic)** - `verify-coverage.mjs` → coverage + gaps.md per layer
8. **Gap Completion** - `uw-complete` for layers with gaps.md (parallel)
9. **Verify → complete loop** until 100% coverage, then handoff to synthesis

## Refresh Mode

If layer folders exist:
1. Pass existing index.md and section files as context
2. Subagents add `## Changes Since Last Review` to index.md
