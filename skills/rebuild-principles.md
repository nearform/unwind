# Rebuild Principles

All Unwind **build** skills (the executors that produce the rebuilt code) follow
these principles. Where `analysis-principles.md` governs *documenting* a codebase,
these govern *recreating* it in the target stack.

> **The goal is functional equivalence, not a literal port.** The rebuild must
> behave the same at its **contracts** (external API surface), preserve the same
> **data model** (entities, fields, relations, invariants), and apply the same
> **business rules** — but it is free to use idiomatic target-stack structure,
> naming, and file layout. We are not translating line-by-line; we are
> re-implementing a specification.

> **Deterministic measurement.** When `@unwind/core` is available, the rebuilt
> target is re-scanned and joined to the source graph by `verify-rebuild.mjs`. A
> node is `equivalent` only when a deterministic cross-manifest diff matches
> (endpoint method+path; table+field names). Everything else is `present`
> (structural) at best. Build for that bar — and know its limits (principle 8).

## 1. Preserve the contract, not the code

The `[MUST]` items in the layer docs are the contract. For each one, reproduce the
**observable behavior and shape**, not the original implementation:
- **API endpoints** — same HTTP method + path (params may be renamed, not removed),
  same status codes, same request/response body shape.
- **Tables/entities** — same logical fields (names may re-case: `orgId`↔`org_id`),
  same types, nullability, defaults, relations, uniqueness, and on-delete behavior.
- **Business rules / formulas** — same inputs produce the same outputs; preserve
  every invariant, edge case, and hardcoded constant the doc records.

## 2. `[MUST]` is inviolable; `[DON'T]` is dropped; `[SHOULD]` is judgment

- **[MUST]** — required for functional equivalence. Never skip one silently. If you
  genuinely cannot build it this slice, leave it unmapped (it surfaces as a gap),
  don't fake it.
- **[DON'T]** — tech-specific to the *source* stack (ORM-specific query syntax,
  framework idioms). Do **not** port it; build the idiomatic target equivalent if
  the behavior is still needed, otherwise omit it.
- **[SHOULD]** — valuable but not contract-critical; build it when it carries over
  cleanly.

## 3. Record every source→target mapping

For every source item you build, record where it landed in the target so
completeness can be **measured**, not asserted. Write one mapping file per slice to
`docs/unwind/.cache/rebuild-map/<sliceId>.json` (the orchestrator gives you the
`sliceId` and `targetRoot`):

```json
{
  "sliceId": "database",
  "targetRoot": "<target repo root>",
  "mappings": [
    {
      "sourceId": "table:src/db.ts:users",
      "targetFiles": ["src/schema/users.ts"],
      "targetIds": ["table:src/schema/users.ts:users"]
    }
  ]
}
```

- `sourceId` is the candidate id from the seed/graph (verbatim — it's the join key).
- `targetIds` use the SAME `kind:path:name` scheme, computed against the **target**
  file you wrote (`table:<target-path>:<Name>`, `endpoint:<target-path>:<METHOD path>`,
  `function:<target-path>:<name>`, `class:…`, or `file:<target-path>:<basename>` for
  whole-file mappings). Paths are relative to `targetRoot`.
- One `[MUST]` source item may map to several target ids (a route split in two) —
  list them all.

## 4. Never silently skip

An item you don't build must be **absent from your mapping** (so it shows as a gap),
never mapped to a stub. The verifier confirms your target ids actually exist in a
fresh scan — a mapping that points at code you didn't really write comes back as
`claimed` (over-claim), which is worse than an honest gap.

## 5. Idiomatic target structure

Lay the target out the way the target stack expects (its conventional folders,
module boundaries, naming). Do not mirror the source's file tree. The mapping
(principle 3) is what ties the two together — not parallel paths.

## 6. Use the spec, link to the source

The layer docs under `docs/unwind/layers/**` are your specification — read the
relevant section for the slice and build to it. The source repo is available for
reference, but the docs (with their `[MUST]/[SHOULD]/[DON'T]` tags) are the
authority on what matters.

## 7. Build incrementally, one slice at a time

Build the slice's items, write the mapping file, and stop. The orchestrator scans +
verifies and decides what's next. Don't try to build the whole system in one pass —
the per-slice verify loop is what makes progress measurable and resumable.

## 8. Honesty about what verification proves

Structural presence (`present`) means the target symbol exists — it does **not**
prove behavior. The deterministic diff proves the *routing surface* and *data-model
shape* only; field **types**, request/response **bodies**, and **business rules** are
not checked by it. When the rebuild's correctness rests on behavior, say so and lean
on the project's tests / equivalence vectors (run-tests verification depth) — never
present `present` as `correct`.

## Graceful Degradation

If `@unwind/core` is unavailable, there is no re-scan and no measured completeness.
Still follow principles 1–8 by judgment, still write the mapping files (they cost
nothing and make a later measured pass possible), and **say** that completeness is
asserted rather than verified.
