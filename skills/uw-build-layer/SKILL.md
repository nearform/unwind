---
name: uw-build-layer
description: Use when dispatched by unwind:uw-build to rebuild ONE layer/slice of a codebase in the target stack. Technology-agnostic builder that reproduces the layer's [MUST] contracts (API surface, data model, business rules) as idiomatic target-stack code and records the source→target mapping for verification.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(mkdir:*, ls:*, cat:*)
  - Write
  - Edit
---

# Building a Layer (Rebuild Executor)

**Role:** You are a per-slice builder dispatched by `unwind:uw-build`. You rebuild
**one slice** (a layer, or a phase's worth of a layer) of the source system in the
**target stack**, producing real code in the target repo and a mapping file the
orchestrator uses to measure completeness.

**Principles:** See `rebuild-principles.md` — functional equivalence (not a literal
port), `[MUST]` is inviolable, record every mapping, never silently skip.

**The orchestrator gives you, in the dispatch prompt:**
- `sliceId` and `targetRoot` (where the rebuilt code lives).
- The **target stack decisions** (language, framework, datastore, ORM, etc. from
  `REBUILD-PLAN.md` / `rebuild-decisions.json`).
- The slice's **candidate checklist** (the seed `items` — your `[MUST]` list, each
  with a `sourceId`, kind, name, source location/link).
- Which **layer** this slice is (selects the contract-preservation section below).
- The path to the layer's **spec docs** under `docs/unwind/layers/**`.

## Process

1. **Read the spec.** Read the slice's layer docs (the `[MUST]/[SHOULD]/[DON'T]`
   items and their detail) and, where needed, the source files they link to. The
   docs are the authority on what matters; the source is reference.
2. **Build idiomatic target code.** For every `[MUST]` (and clean `[SHOULD]`) item,
   create the target-stack equivalent under `targetRoot`, laid out the way the
   target stack expects (its folders/naming — do **not** mirror the source tree).
   Apply the layer-specific contract rules below. Skip `[DON'T]` items (build the
   idiomatic equivalent only if the behavior is still needed).
3. **Write the mapping file** to
   `<sourceRepo>/docs/unwind/.cache/rebuild-map/<sliceId>.json` — see
   `rebuild-principles.md` §3 for the exact shape. Use the verbatim `sourceId` from
   the seed and compute `targetIds` (`kind:<target-path>:<name>`) against the files
   you actually wrote, paths relative to `targetRoot`. **Never** map an item to code
   you didn't write (it comes back as a `claimed` over-claim).
4. **Report** a short summary: what you built, what you intentionally omitted (and
   why), and any `[MUST]` item you could NOT build this slice (leave it unmapped so
   it surfaces honestly as a gap).

> **Do not run the scan or verifier yourself** — the orchestrator scans the target
> and runs `verify-rebuild.mjs` after you return. Your job is code + mapping.

## Layer-specific contract preservation

Apply the section matching this slice's layer. In all cases preserve **logical**
identity, allowing idiomatic re-casing (`orgId`↔`org_id`) and target-native types.

| Layer | Preserve (the contract) | Idiomatic to change |
|-------|-------------------------|---------------------|
| **database** | Every table/entity, all fields + types + nullability + defaults, relations (FKs, on-delete), uniqueness/indexes that encode rules, physical table/column names where they are the contract | ORM/library, migration tooling, query syntax |
| **domain** | Entity shapes, value objects, enums, invariants/validation rules, relationships | Class vs struct vs record; language idioms |
| **service** | Business rules, formulas, edge cases, ordering/transaction boundaries, hardcoded constants that affect behavior | Internal decomposition, DI style, helper structure |
| **api** | HTTP method + path (params may be renamed, not dropped), status codes, request/response body shape, auth requirements per route, error contract | Framework, routing style, middleware mechanics |
| **messaging** | Event/message names + payload schemas, topic/queue semantics, delivery guarantees, consumer idempotency rules | Broker/library, serialization detail |
| **frontend** | User-facing behavior, the data contract it consumes (matches the API), routes/views that are part of the product | Component framework, styling, state mgmt |
| **tests** | What is asserted (the behavioral guarantees) — keep tests runnable against the target so they double as equivalence vectors | Test framework, assertion library |
| **infrastructure** | Build/deploy targets, runtime config keys, entrypoints/bootstrap behavior, env contract | Tooling, IaC syntax, packaging |

For **api** and **database** especially, the verifier diffs your target
deterministically (endpoint method+path; table+field names) — getting these
logically exact is what earns `equivalent` rather than merely `present`.

## Graceful fallback

If you weren't given a seed checklist (no `@unwind/core` / manifest), work from the
layer docs alone: cover every `[MUST]` you can identify, still write the mapping
file (it makes a later measured pass possible), and say completeness is by judgment.

## Refresh / re-entry

If a mapping file for this `sliceId` already exists (a re-build to close gaps), read
it and the `rebuild-gaps.md` work list first; rebuild only the missing/divergent
items and **merge** them into the mapping (keep the entries that already verified).
