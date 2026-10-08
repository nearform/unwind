# 02 · Destination architecture

> **In short:** One shared model package, two plugins and one contract between them. **Rewind** understands a legacy system and compiles it into a stack-neutral **Spec**. **Play** rebuilds the Spec from a client's **Target Kit**. A single engine sits behind a **CLI-first** surface, with MCP and an App as thin adapters. Deterministic code owns the facts and the structure; the LLM owns semantics and holes; completeness is always computed.

![The big picture](diagrams/01-big-picture.svg)

## 2.1 The shape

```
            ┌──────────── @unwind/model (shared contract) ────────────┐
            │ ids · Semantic Model · Spec (IR) · Kit schema ·          │
            │ verification + state schemas · versioning                │
            └──────────────────────────────────────────────────────────┘
 SOURCE REPO ─► REWIND ─► Semantic Model ─► tagged docs ─► SPEC ──────┐
              (understand)   (facts)        (LLM + grill)  (neutral)  │
                                                                      ▼
 CLIENT KIT REPO ─► TARGET KIT (profile · conventions · recipes ·    PLAY ─► TARGET REPO
 (mined from ref app)  blueprints · golden fixtures)                 (rebuild)   │
                                                                      ▲          │
                                 VERIFY (target re-scanned by Rewind ◄───────────┘
                                         → diffed against the Spec)
 SPEC ─► CONTEXT GAPS ─► interview briefs ─► (external interview tool) ─► answers ─► enrich SPEC
 SPEC ─► PARITY SCENARIOS ─► run vs LEGACY (observe → goldens → enrich SPEC)
                        └──► run vs TARGET (same scenarios → behavioural parity)
```

## 2.2 Today compared with the destination

![Today's uw-* pipeline vs the Rewind/Play destination](diagrams/02-today-vs-destination.svg)

| Today (`uw-*`) | Destination | Change |
|---|---|---|
| `uw-scan` → `scan-manifest.json` | `rw-scan` → **Semantic Model** (typed, bound) | Additive manifest fields; extra tiers ([04](04-semantic-model.md)) |
| `uw-analyze-*`, `uw-verify`, `uw-complete` | Same, under `rw-*` | Rename plus aliases |
| `uw-grill` → `questions/` | `rw-grill`, folded into **context gaps** | One questionnaire mechanism ([05b](05b-context-gaps.md)) |
| (none) | `rw-spec` → **Spec** | New: the Rewind→Play contract |
| (none) | `rw-observe` / `pl-parity` | New: behaviour parity ([05](05-behaviour-parity.md)) |
| `uw-plan`, free-text stack decisions | `pl-plan`: **choose or tailor a Kit** | Typed profile replaces free text |
| `uw-build-layer` writes every line | `pl-build`: **generate from Kit**, LLM fills holes | Deterministic first ([03](03-target-kits-and-recipes.md)) |
| `verify-rebuild`: names, method+path, field-name Jaccard | Plus field **types**, holes, behavioural parity | Stronger verdicts |
| `skills/scripts/*.mjs` | `unwind` CLI (scripts become shims) | Consolidation (§2.8) |

## 2.3 `@unwind/model`: the shared contract

The only package both plugins import. It holds:

- **The id scheme.** Today this is `manifest/candidates.ts` and `symbolId` in `manifest/manifest-schema.ts` (`kind:path:name`). The destination version adds class-qualified, overload-safe ids (e.g. `method:src/a.ts:Orders.create(2)`), because methods and overloads collide today. Ids remain the **join key** across the model, Spec, coverage, graph, kit output and verification.
- **Schemas:** Semantic Model (additive extension of `ScanManifest`), Spec, Kit manifest, rebuild state and verification (today's `graph/rebuild-state-schema.ts` and `graph/rebuild-verification.ts` types), the gap register and Scenario.
- **Versioning.** Every artifact carries `schemaVersion`. Changes are **additive-only**, as with the manifest today; breaking changes need a migration and a major bump.

## 2.4 Rewind (understand)

Today's pipeline (scan → seed → analyze → verify-coverage → complete → grill), extended with:

1. **Semantic Model**: a typed, bound fact model in tiers T0/T1/T2 ([04](04-semantic-model.md)).
2. **Detector recipes**: `layers/contract-detectors.ts` split into a fixture-tested registry.
3. **`rw-spec`**: compiles manifest, graph and tagged docs into the **Spec**.
4. **`rw-observe`**: runs Spec scenarios against the legacy app and enriches the Spec ([05](05-behaviour-parity.md)).
5. **`rw-context-gaps`**: finds what the code can't answer and produces interview briefs ([05b](05b-context-gaps.md)).

Rewind is **useful on its own** for documentation, onboarding, audits and due diligence, without ever running Play.

## 2.5 The Spec: the only Rewind → Play contract

A stack-neutral, typed IR of everything the target must preserve. Where a standard exists, the Spec **embeds** it rather than inventing a format: JSON Schema for shapes, OpenAPI-style operations for endpoints.

| Node kind | Carries |
|---|---|
| `entity` | Typed fields (neutral types), keys, FKs/relations, enums, physical name |
| `endpoint` | Full composed path, method, params, request/response schema refs, auth, status codes, handler ref |
| `event` / `job` | Payload schema, producer/consumer, schedule |
| `config` | Env/config keys, defaults, secrets flag |
| `integration` | External system, protocol, calls made |
| `operation` | A named business rule: description, doc ref, behavioural assertions, linked scenarios |
| `scenario` | Given/when/then at a boundary ([05](05-behaviour-parity.md)) |

Every node carries `id`, `priority` (`MUST`/`SHOULD`/`DONT` plus rationale), `docRef`, `sourceRef` and **provenance**: `scanned`, `inferred`, `observed`, `interview:<role>:<date>` or `expert`.

```json
{
  "schemaVersion": "1.0",
  "entities": [{
    "id": "table:src/db/schema.ts:orders",
    "name": "orders", "priority": "MUST",
    "fields": [
      { "name": "id", "type": "uuid", "pk": true },
      { "name": "customerId", "type": "ref(customers)", "nullable": false },
      { "name": "status", "type": "enum(pending,paid,shipped,cancelled)" },
      { "name": "totalCents", "type": "int" },
      { "name": "createdAt", "type": "datetime", "default": "now" }
    ],
    "docRef": "layers/database/tables.md#orders",
    "provenance": ["scanned", "inferred"]
  }],
  "endpoints": [{
    "id": "endpoint:src/routes/orders.ts:POST /api/orders",
    "method": "POST", "path": "/api/orders", "priority": "MUST",
    "request": { "$ref": "#/schemas/CreateOrder" },
    "responses": { "201": { "$ref": "#/schemas/Order" }, "422": { "$ref": "#/schemas/ValidationError" } },
    "auth": "session", "handlerRef": "function:src/services/orders.ts:createOrder",
    "provenance": ["scanned", "observed"]
  }],
  "operations": [{
    "id": "operation:src/services/orders.ts:applyDiscount",
    "priority": "MUST",
    "rule": "Orders over 10000 cents get 5% off; never stack with coupon discounts.",
    "rationale": "Contractual with wholesale customers (interview:stakeholder:2026-11-02)",
    "docRef": "layers/service/orders.md#applydiscount",
    "scenarios": ["scenario:orders:discount-threshold"],
    "provenance": ["inferred", "interview:stakeholder:2026-11-02"]
  }]
}
```

A Spec can also be **hand-written**, which makes Play usable for greenfield work.

## 2.6 Play (rebuild)

1. **`pl-plan`.** The interview narrows to *choosing or tailoring a Kit*: phasing, re-use and risk. It writes a typed profile in place of today's free-text `rebuild-decisions.json` (which stays as a record).
2. **Resolve the Kit.** Pin `kit@version` in `rebuild-state.json`.
3. **Generate.** Recipes and blueprints run over the Spec and write target files, map entries (the existing `rebuild-map/*.json` format) and **holes** ([03](03-target-kits-and-recipes.md)). The scaffold recipe finally sets the dormant `config.scaffolded` flag in `rebuild-state-schema.ts`.
4. **Fill.** `pl-build-layer` subagents fill *only* holes plus any unmapped `[MUST]` items.
5. **Verify.** Structural and typed diff (an extended `graph/rebuild-verification.ts`), hole accounting, and behavioural parity (`pl-parity`).
6. **Loop.** The existing loop-until-verified mechanics, with completeness % and parity % as termination signals.

**Fallback.** If there is no Kit match, or no Node/core, today's pure-LLM `uw-build` flow runs unchanged, and the skill says so.

## 2.7 Target Kits

Per-client, versioned git repos that encode the client's **golden path**: stack profile, conventions, type map, recipes, blueprints and golden fixtures. They are mined primarily from the client's reference app. Starter kits (first: `hono-drizzle-zod`) ship with Play. See [03](03-target-kits-and-recipes.md).

## 2.8 Surfaces: one engine, CLI first, thin adapters

![One engine; CLI primary; MCP and serve as adapters](diagrams/10-surfaces.svg)

```
@unwind/engine (library: model, rewind, play, kits, parity, gaps, store)
     ├── unwind CLI      ← PRIMARY. Skills shell out to it. CI / humans / any agent.
     ├── unwind mcp      ← thin stdio MCP adapter: tools map 1:1 to CLI commands
     └── unwind serve    ← later: HTTP API (mirrors CLI) + App + store
```

**Why CLI rather than MCP for the skills:**
- The skills already shell out to `node skills/scripts/*.mjs` via `_resolve-plugin-root.sh`/`ensure_unwind_core`. That is a CLI in all but name, so this is a consolidation.
- A CLI works in CI, for humans and from any agent, with no daemon or connection state. MCP availability varies by client and would weaken the graceful fallback.
- `--json` output and exit codes make it testable. Long-running steps (generate, parity) fit processes better than tool calls.

**Command map:**

```
unwind rewind  scan | seed | coverage | grill-brief | spec | observe | context-gaps | context-ingest
unwind play    plan-brief | kit mine | kit test | generate | merge | verify | parity
unwind         graph | publish | serve | mcp
common flags   --project <src> --target <dir> --kit <repo@ver> --json --plan (dry run)
```

**Distribution** is an npm package (`npx @unwind/cli`). `ensure_unwind_core` becomes `ensure_unwind_cli`. The current `.mjs` scripts become one-line shims for one release.

**MCP and HTTP are adapters with no logic of their own**, so behaviour is identical across surfaces.

The **App** is today's dashboard (`packages/dashboard`) extended with a Recipe Book browser, Kit editor and portfolio view. It is served by `unwind serve` once the store exists.

## 2.9 Packaging and naming

- One repo and two plugins: **Rewind** (`rw-*` skills) and **Play** (`pl-*` skills). **Unwind** stays the umbrella brand.
- Packages: `@unwind/model`, `@unwind/engine` (initially today's `@unwind/core`, renamed and grown), `@unwind/cli`, `@unwind/dashboard`.
- The `uw-*` skills stay as deprecated aliases for one release.

## 2.10 Invariants

- **Hybrid rule.** Deterministic code owns every verifiable fact and every structural artifact. The LLM owns semantics and holes. Completeness is computed by set arithmetic over ids.
- **Additive schemas only.** No reshaping `FileSymbols`; add optional fields.
- **AST and real parsers over regex**, on both sides: detectors read ASTs, and recipes edit target files with ts-morph or tree-sitter.
- **Graceful fallback at every step**, announced to the user.
- **Files are the source of truth.** The store is a rebuildable index.
