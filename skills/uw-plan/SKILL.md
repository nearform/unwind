---
name: uw-plan
description: Use after layer analysis is complete to interview the user about the rebuild strategy (target stack, what to keep vs rebuild, phasing, risk) and generate a data-grounded REBUILD-PLAN.md that records those decisions.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(mkdir:*, ls:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/.cache/**)
  - Write(docs/unwind/**)
  - Edit(docs/unwind/**)
  - AskUserQuestion
---

# Synthesizing Findings → Rebuild Strategy

## Overview

Transform layer analysis into a **strategic rebuild plan** that answers HOW to
rebuild, not WHAT to rebuild. The plan is **co-authored with the user**, not guessed:
the strategic decisions that shape a rebuild — target stack, what to keep vs rebuild,
migration approach, phasing, risk tolerance — are ones only the user can make.

This skill **grills the user** the way the `grilling` skill does: walk the decision
tree one branch at a time, resolving dependencies in order, and **for every question
provide a recommended answer derived from the deterministic data**. If a question can
be answered from the scan/coverage data, **answer it from the data — don't ask**.

**Key Principle:** Layer docs are the source of truth for what exists. This plan
records the strategic *decisions* about re-use, phasing, and approach — grounded in the
deterministic brief — and references the layer docs for the detail.

**Requires:** `docs/unwind/layers/*/index.md` from layer specialists + verification reports
**Produces:**
- `docs/unwind/REBUILD-PLAN.md` — strategic rebuild approach, target stack, and a decisions log
- `docs/unwind/.cache/rebuild-decisions.json` — machine-readable record of the interview answers
- Updated `docs/unwind/architecture.md` if corrections needed after detailed analysis

## Prerequisites

Before using this skill:
1. All detected layers have been analyzed
2. Verification pass has completed (coverage reports exist under `.cache/coverage/`)
3. Layer folders exist in `docs/unwind/layers/` with index.md + section files

---

## Phase A — Brief (deterministic intake)

Build the **rebuild brief**: the verifiable facts that ground every interview
question. Run the deterministic script:

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || echo "core unavailable — using legacy artifact reading"
node "$UNWIND_PLUGIN_ROOT/skills/scripts/plan-brief.mjs" "$(pwd)"
```

This writes `docs/unwind/.cache/plan-brief.json`. **Read it.** It contains:
- `project` — name, languages, `estimatedComplexity`, file counts.
- `detected` — the **current** stack: `languages`, `ormSources` (data-access framework
  in use, e.g. `{drizzle: 39}`), `endpointMethods`. Use this to recommend concrete
  *targets* per element ("on Drizzle today → keep, or move to X?").
- `perLayer[]` — per layer: file/candidate/symbol counts, coverage %, and
  `[MUST]/[SHOULD]/[DON'T]` tallies. Use these to weight effort and confidence.
- `contracts` — `dataModels`, `sqlDdl`, `dataModelLinks` (ORM↔SQL pairs to reconcile),
  `endpoints` (+ by method). The API/data surface that must be preserved.
- `importGraph` — `foundations` (depended-upon leaves: build first) and `hubs` (most
  depended-upon files). Seeds the phasing order.
- `readiness` — overall coverage % and `provisionalLayers` (< 100%). Where the plan
  must flag itself provisional.

Also:
- Skim `docs/unwind/architecture.md` for layer boundaries and cross-cutting concerns.
- **Read the project's dependency manifest(s)** — `package.json` (+ `pnpm-lock`/`bun`),
  `requirements.txt`/`pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `*.csproj` —
  to learn the **concrete current libraries** (web framework, validation, auth, queue,
  HTTP client, test runner). This is what lets you recommend *specific* target modules
  in the stack interview rather than generic categories.

**Graceful fallback** (per the repo's degrade-gracefully rule):
- If the script exits non-zero (core/manifest unavailable), **read the artifacts
  directly**: `docs/unwind/.cache/scan-manifest.json`, `.cache/coverage/*.json`, and
  `grep` the `[MUST]/[SHOULD]/[DON'T]` tags across `docs/unwind/layers/**`. Say so.
- If even those are absent, fall back to the **legacy flow**: read the layer `index.md`
  files for counts and readiness. Say that the brief is approximate.

Then validate `architecture.md` against the detailed findings (layer boundaries
accurate? layers added/removed? cross-cutting concerns right?) and update it if needed.

**Present a short factual summary** of the brief to the user (a few lines: stack,
complexity, contract surface, readiness, the largest layers) before the interview, so
they answer with the facts in view.

---

## Phase B — Grill (the interview)

Walk the decision tree in **dependency order**, asking **one decision (or one
tightly-coupled cluster) per `AskUserQuestion` call**. Asking everything at once is
bewildering and breaks the dependency chain. For each question:

- **List the recommended option first** with `(Recommended)` in the label, derived
  from the brief. Give the data behind it in the option description.
- **Feed each answer into the framing of the next** question — later branches depend on
  earlier ones (e.g. target stack determines what counts as `[DON'T]` tech-specific).
- **Skip any question the brief already answers.** (Grilling's escape hatch: if the
  data answers it, don't ask — state the answer and move on.)
- Offer **"Accept all recommended defaults"** as an option in the *first* question so a
  user in a hurry (or `uw-start` run-to-dashboard mode) can one-shot the interview. The
  decisions are still recorded with their recommended values.

The tree has two parts: **B1 — pin the exact target stack & architecture** (drill deep,
relentlessly), then **B2 — re-use, phasing & validation**. B1 is the heart of the
interview — don't settle for a one-line "rebuild in TypeScript". Keep drilling each
element until the choice is concrete and named (a specific framework/library/version),
because every B1 answer changes what downstream code is `[MUST]` vs `[DON'T]`
tech-specific.

### B1 — Target stack & architecture (drill until concrete)

Ask these as **separate questions**, in order, each recommended-first from `detected`
+ the dependency manifest. Adapt: skip a question if the project clearly has no such
element (no frontend ⇒ skip frontend framework), and **add follow-ups** when an answer
opens a new branch (picking a meta-framework ⇒ ask routing/rendering mode).

1. **Language & runtime** — e.g. TypeScript on Node / Bun / Cloudflare Workers / Deno;
   Go; Python 3.x. Recommend from `detected.languages`. The runtime constrains
   everything below (Workers ⇒ no native Node APIs, etc.).
2. **Backend framework** — name one: Hono / Express / Fastify / NestJS (TS), FastAPI /
   Django / Flask (Py), Gin / Echo (Go)… Recommend by runtime fit + the current
   framework from the dependency manifest.
3. **API contract style** — REST / tRPC / GraphQL / gRPC. Default REST when
   `contracts.endpoints > 0` (preserve the existing surface); flag if moving off REST
   breaks the documented endpoint contract.
4. **Datastore & data-access** — DB engine (Postgres / MySQL / SQLite / D1 / Mongo) and
   ORM/query layer (Drizzle / Prisma / Kysely / raw SQL / SQLAlchemy). Recommend from
   `detected.ormSources` and `dataModelLinks`. (The keep-vs-migrate *data* decision is
   B2 §1 — here we pick the access tech.)
5. **Frontend framework** *(if a `frontend` layer exists)* — React / Vue / Svelte /
   Solid, and meta-framework if any (Next / Remix / Astro / SvelteKit), plus
   styling (Tailwind / CSS modules) and state/data-fetching (TanStack Query, etc.).
6. **Per-element modules — go concern by concern.** For each cross-cutting concern the
   brief/architecture surfaced, ask which specific library to use: **auth**
   (Lucia / Auth.js / Clerk / custom JWT), **validation** (Zod / Valibot / Pydantic),
   **messaging/queue** (if a `messaging` layer exists — BullMQ / Cloudflare Queues /
   SQS), **caching**, **background jobs / cron**, **email/notifications**, **file
   storage**, **observability/logging**, **testing framework** (Vitest / Jest /
   Playwright). Recommend the current library (from deps) as the default and offer 1–2
   modern alternatives. Ask explicitly: *"Any specific modules you want to use for any
   part of the solution?"* and capture free-form answers.
7. **Hosting / deployment target** — Cloudflare Workers / Vercel / AWS (Lambda / ECS) /
   Fly / containers / bare VM. This often retro-constrains §1–§4 — if it conflicts with
   an earlier answer, surface the conflict and re-confirm.
8. **High-level architecture confirmation** — replay the **discovered** structure (the
   layers from the brief/architecture.md and their dependencies) and confirm the target
   shape: keep the same layer boundaries? monolith vs modular-monolith vs services?
   Map each documented layer onto a target module. Get explicit sign-off that the
   target architecture preserves the `[MUST]` contracts and data model.

Before leaving B1, **play back the full assembled stack** ("So: TS + Hono on Workers,
REST, Drizzle + D1, React + Tailwind, Zod, Vitest, Cloudflare Queues — correct?") and
get a single confirmation, so the stack is locked as one coherent set, not eight
disconnected picks.

### B2 — Re-use, phasing & validation

9. **Database strategy** — keep live / snapshot+restore / sync (change events, dual
   write). Default informed by `contracts.dataModels` / `dataModelLinks` and table count
   (more ORM↔SQL links ⇒ schema well-pinned ⇒ reuse safer).
10. **Frontend retention** — keep the existing UI and replace only the backend, vs
    rebuild (already partly answered if B1 §5 chose a new frontend framework). Default
    informed by whether a `frontend` layer exists and API-contract rigidity.
11. **Test re-use** — run existing tests against the rebuild, vs rewrite. Default
    informed by the `tests` layer coverage and coupling.
12. **Integrations / scheduled jobs** to preserve — from the contract inventory and
    messaging layer.
13. **Phasing priority & order** — seeded by `importGraph.foundations` (build leaves
    first) and `[MUST]` weighting per layer. Confirm the order and the first slice.
14. **Validation approach & risk tolerance** — parallel-run, equivalence vectors,
    go-live gating.

The user can wrap up at any point ("accept the rest as recommended", "stop here") —
honor it and record the remaining decisions at their recommended values.

### Record every decision

As decisions land, accumulate a list of records (one per question). After the
interview, write the machine-readable record to
`docs/unwind/.cache/rebuild-decisions.json`:

```json
{
  "version": "1.0.0",
  "generatedAt": "<ISO timestamp>",
  "decisions": [
    {
      "id": "RD-1",
      "topic": "Target stack",
      "question": "What stack should the rebuild target?",
      "recommended": "<data-grounded default you proposed>",
      "chosen": "<what the user picked>",
      "rationale": "<the brief data that informed it + why the user chose>"
    }
  ]
}
```

---

## Phase C — Synthesize (write the plan)

Write `docs/unwind/REBUILD-PLAN.md`, grounded in the brief **and** the confirmed
decisions. Each strategic section records the **decision the user made**, its rationale,
and the brief data that informed it — never an LLM guess.

**CRITICAL:** Never copy content from layer docs. Only reference them (anti-patterns below).

### Output Format: REBUILD-PLAN.md

```markdown
# [Project Name] - Rebuild Strategy

> Generated by Unwind on [timestamp]

## Target Stack

**From:** [detected source stack — language/framework/runtime/datastore/ORM]
**To (assembled in B1):**

| Element | Choice | From (current) |
|---------|--------|----------------|
| Language & runtime | [e.g. TypeScript / Cloudflare Workers] | [detected] |
| Backend framework | [e.g. Hono] | [detected] |
| API contract style | [REST / tRPC / GraphQL] | [detected] |
| Datastore | [e.g. D1 / Postgres] | [detected] |
| Data access / ORM | [e.g. Drizzle] | [detected ormSources] |
| Frontend | [framework + meta + styling, or "retained as-is"] | [detected] |
| Auth | [module] | [detected] |
| Validation | [module] | [detected] |
| Messaging / jobs | [module] | [detected] |
| Testing | [framework] | [detected] |
| Hosting / deploy | [target] | [detected] |
| Other requested modules | [free-form picks from B1 §6] | — |

**Changing:** [parts being re-platformed]   **Staying:** [parts retained]
**Architecture:** [confirmed shape from B1 §8 — monolith/modular/services; layer→module map]

## Executive Summary

**Overall Readiness:** [overall coverage % from the brief] — provisional in: [layers < 100%]
**Recommended Approach:** [one line, e.g. "Rebuild backend on the target stack, retain frontend + live DB"]

---

## Strategic Decisions

> Each decision below was made during the rebuild interview and is recorded in
> `## Rebuild Decisions`. Assessments cite the deterministic brief.

### Database Strategy
**Decision:** [chosen]  **Why:** [rationale + brief data — dataModels/links/table count]
**If live DB not feasible:** [ ] snapshot+restore  [ ] sync mechanism  [ ] dual-write

### Frontend Retention
**Decision:** [chosen]  **Why:** [rationale + brief data]
**API contract:** preserve exactly [critical endpoints — count from brief]; can evolve [areas]

### Test Re-usability
**Decision:** [chosen]  **Why:** [test-layer coverage + coupling]
**Adapters needed:** [ ] [list]

### Integration Preservation
| Integration | Contract Type | Must Preserve |
|-------------|---------------|---------------|
| [Name] | [webhook/API/job] | [Yes/No + reason] |

---

## Phasing Strategy

> Order seeded by the import graph (foundations first) and [MUST] weighting.

### Phase 1: Foundations
**Build first:** [foundations from the brief — depended-upon leaves]
**Retain / Adapt / Rebuild:** [...]   **Reference:** [layers/xxx/index.md]
**Validation:** [ ] [check]

### Phase 2: Core Logic
[Same structure — highest-[MUST] layers]

### Phase 3: Interfaces (API)
[Same structure — preserve the [count] endpoints]

### Phase 4: Frontend (if rebuilding)
[Same structure]

### Phase 5: Integration & Cutover
**Parallel running:** [old vs new] · **Traffic split** · **Rollback triggers**

---

## Validation Strategy

**Equivalence testing:** [how to prove the rebuild matches — cite test-layer coverage]
**Test vectors:** [ ] existing integration tests pass  [ ] calc outputs match  [ ] API responses identical
**Go-live checklist:** [ ] phase validations  [ ] parallel-run [duration]  [ ] rollback tested  [ ] monitoring

---

## Rebuild Decisions

> The interview answers (also in `.cache/rebuild-decisions.json`).

> One row per question — the B1 stack sub-tree (language, framework, API style,
> datastore, ORM, frontend, per-element modules, hosting, architecture) each get their
> own RD id, then the B2 re-use/phasing/validation decisions.

| ID | Topic | Recommended | Chosen | Rationale |
|----|-------|-------------|--------|-----------|
| RD-1 | Language & runtime | [rec] | [chosen] | [why] |
| RD-2 | Backend framework | [rec] | [chosen] | [why] |
| RD-3 | API contract style | [rec] | [chosen] | [why] |
| RD-4 | Datastore & ORM | [rec] | [chosen] | [why] |
| ... | (frontend, auth, validation, …, architecture) | | | |
| RD-n | Database re-use | [rec] | [chosen] | [why] |
| RD-n+1 | Phasing order | [rec] | [chosen] | [why] |

---

## Layer Documentation References

> These documents contain the detailed specifications. This plan records strategic decisions only.

| Layer | Reference | Coverage |
|-------|-----------|----------|
| Database | [layers/database/index.md](layers/database/index.md) | [%] |
| ... | | |
```

---

## Anti-Patterns

**NEVER do these:**
1. **Copy tables/code from layer docs** — reference the link instead
2. **List every endpoint/table/entity** — that's what layer docs are for
3. **Invent the strategic decisions** — they come from the interview, recorded with rationale
4. **Repeat WHAT to build** — only discuss HOW to approach it

**ALWAYS do these:**
1. **Ground every recommendation in the brief** — cite counts, coverage, the import graph
2. **Record the user's decisions** — both in the plan and `rebuild-decisions.json`
3. **Order phasing by the dependency graph** — foundations first, [MUST] weighting
4. **Flag provisional layers** — where coverage < 100%, say the plan is approximate there

---

## Refresh Mode

If a rebuild plan exists:
1. Read existing plan + `rebuild-decisions.json`
2. Re-run `plan-brief.mjs`; compare to the recorded decisions
3. **Re-confirm only the decisions the new brief invalidates** (don't re-grill from scratch)
4. Add a `## Changes Since Last Plan` section; update `rebuild-decisions.json`
5. Validate architecture.md still accurate

## After Completion — continue or pause?

Announce what was produced:
> Rebuild strategy complete. See:
> - `docs/unwind/REBUILD-PLAN.md` — strategy, target stack, and decisions log
> - `docs/unwind/.cache/rebuild-decisions.json` — machine-readable decisions
> - `docs/unwind/architecture.md` — validated architecture overview
>
> The layer documentation contains the detailed specifications. The rebuild plan
> records HOW to approach the rebuild, not WHAT to build.

Analysis is now complete. The natural next step is to **visualize** it — the
dashboard builds its data (`rebuild-graph.json`) on demand, so you go straight there.

**Use AskUserQuestion** to ask whether to continue:
- **Open the dashboard** *(recommended)* — invoke `unwind:uw-dashboard`; it
  (re)generates `rebuild-graph.json` from the current scan + docs and launches.
- **Export the graph artifact only** — invoke `unwind:uw-graph` to write
  `rebuild-graph.json` without a server (for static deploy / CI / sharing).
- **Pause here** — stop after the plan.

Act on the choice in the same turn; if they pause, tell them how to resume: *"Run
`unwind:uw-dashboard` (type `/uw-dashboard`) to explore the rebuild graph."*

> **Pipeline:** scan → analyze → **plan ✓** → dashboard. `uw-graph` is an optional
> artifact-export step, not a gate — the dashboard builds the graph itself.
