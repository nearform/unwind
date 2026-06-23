# Bug report: verify-coverage reports false 0% for domain / tests / infrastructure (layer→folder name mismatch)

- **Date:** 2026-06-23
- **Version:** unwind 0.8.3 (reproduced from plugin cache `~/.claude/plugins/cache/cliftonc/unwind/0.8.3`)
- **Reporter:** observed during a full `uw-start` → scan → analyze run on a small Spring Boot + MongoDB repo
- **Severity:** High — the headline "deterministic completeness" guarantee silently under-reports coverage, and the verify→complete loop **cannot converge** for affected layers.

## TL;DR

Three different naming schemes for "layer" never reconcile:

| Source of truth | `domain` layer | `tests` layer | `infrastructure` layer |
|---|---|---|---|
| Scanner / seed file key (`seed-layers.mjs`) | `domain` | `tests` | `infrastructure` |
| `LAYER_DOC_DIR` in `skills/scripts/_core.mjs` (what `verify-coverage` reads) | `domain-model` | `tests` | `infrastructure` |
| Folder actually written by the specialist sub-skill | `domain-model` (per `uw-analyze-domain/SKILL.md`) | `unit-tests` / `integration-tests` / `e2e-tests` | *(no specialist exists)* |
| Folder the `uw-analyze` orchestrator tells the dispatched agent to create | `docs/unwind/layers/[layer]/` → **ambiguous** | same | n/a |

Result: `verify-coverage` reads an empty/nonexistent directory and reports **0%** even though every item is documented with a correct `<!-- id: ... -->` anchor. Because `gaps.md` is only emitted when `existsSync(docDir)` is true, **no gaps.md is generated either**, so `uw-complete` has nothing to act on and the loop is stuck.

## Reproduction

Ran `uw-scan` → `uw-analyze` on an 8-file repo. All four dispatched specialists self-reported 100% coverage with anchor-id headings. `verify-coverage.mjs` then reported:

```
verify-coverage: layer coverage (covered/total = pct%)
  api               16/16   =   100%  (byId=16 fuzzy=0)
  database           1/2    =    50%  (byId=1 fuzzy=0)  <-- gaps
  domain             0/12   =     0%  (byId=0 fuzzy=0)  <-- gaps
  infrastructure     0/6    =     0%  (byId=0 fuzzy=0)  <-- gaps
  tests              0/2    =     0%  (byId=0 fuzzy=0)  <-- gaps
```

Yet the domain docs exist and the ids match the seeds exactly:

```
docs/unwind/layers/domain/entities.md:8:
  ### Tutorial.java [MUST] <!-- id: file:.../model/Tutorial.java:Tutorial.java -->
docs/unwind/layers/domain/entities.md:45:
  ### Tutorial [MUST] <!-- id: class:.../model/Tutorial.java:Tutorial -->
```

Folders on disk vs. what the verifier reads:

```
$ ls docs/unwind/layers/      →  api  database  domain  unit-tests
$ ls docs/unwind/layers/domain-model docs/unwind/layers/tests
  ls: docs/unwind/layers/domain-model: No such file or directory
  ls: docs/unwind/layers/tests:        No such file or directory
```

`api` (folder==`api`==`LAYER_DOC_DIR.api`) and `database` (folder==`database`==`LAYER_DOC_DIR.database`) both resolve correctly, which is why only those two report non-zero coverage. This isolates the cause to the folder-name resolution, not the id-matching logic.

## Root causes (three distinct bugs)

### Bug 1 — `domain`: orchestrator writes `domain/`, verifier reads `domain-model/`

- `skills/scripts/_core.mjs:38` → `LAYER_DOC_DIR.domain = "domain-model"`.
- `skills/uw-analyze-domain/SKILL.md:15` correctly documents the output as `docs/unwind/layers/domain-model/`.
- But the **orchestrator** (`skills/uw-analyze/SKILL.md`, Step 3 dispatch template) instructs: `Output folder: docs/unwind/layers/[layer]/`, where `[layer]` is taken from the **seed/scan layer name** (`domain`) — not from `LAYER_DOC_DIR`. The seed file is literally `docs/unwind/.cache/seeds/domain.json`.
- So a dispatching agent that follows the orchestrator template verbatim creates `layers/domain/`, while the verifier (and the sub-skill's own spec) expect `layers/domain-model/`.

The two names are wired from different places and there is no single normalization step. The orchestrator's `[layer]` placeholder is **underspecified**: it must be the `LAYER_DOC_DIR` value, not the seed key.

### Bug 2 — `tests`: scanner emits ONE `tests` layer; specialists fan out to THREE folders

This one is **dispatch-independent** — it is broken even if every skill is followed perfectly:

- `seed-layers.mjs` emits a single `tests` layer (seed `tests.json`), and `LAYER_DOC_DIR.tests = "tests"`, so `verify-coverage` reads `docs/unwind/layers/tests/`.
- But the test specialists are designed to fan out: `uw-analyze-unit-tests/SKILL.md:15` writes `unit-tests/`, and there are sibling `integration-tests/` / `e2e-tests/` skills. `uw-help` and `uw-plan` both reference `unit-tests/` etc.
- There is **no `tests/` folder ever created**, so the single scanner `tests` layer is always 0%. The verifier has no concept of one scanner-layer mapping to multiple doc folders.

### Bug 3 — `infrastructure`: a seeded, verified layer with no analysis path

- `seed-layers.mjs` emits an `infrastructure` layer (here 6 items: `pom.xml`, `README.md`, `application.properties`, `SpringBootDataMongodbApplication` class, its `main`, the app file), and `LAYER_DOC_DIR.infrastructure = "infrastructure"`, so `verify-coverage` expects `layers/infrastructure/` and counts it toward coverage.
- But there is **no `uw-analyze-infrastructure` skill** (`ls skills | grep infra` → none) and the `uw-analyze` Step 2 execution phases never dispatch one. The `uw-scan` architecture.md template also treats infrastructure as a side-section, not a `layers:` entry.
- Net: infrastructure is **structurally guaranteed to be 0%** and the gap is uncloseable — `uw-complete` has no skill to route it to.

### Bug 4 (lower severity / design question) — `file:` pseudo-items double-count single-class files

- `database` reported 1/2: the `class:TutorialRepository` id matched, but the `file:TutorialRepository.java:TutorialRepository.java` id did not, because the agent documented the class (not a separate file-level heading).
- For a file containing a single class/interface, requiring a *separate* `file:` anchor heading in addition to the `class:` heading is redundant and will routinely show as a phantom gap. Consider: treat a `file:` candidate as covered when any symbol from that file is documented, or drop `file:` pseudo-items from the candidate set when the file's symbols are individually seeded.

## Secondary effect: gaps.md not generated, loop cannot converge

`verify-coverage.mjs` only writes `gaps.md` when `cov.missing.length > 0 && existsSync(docDir)`. Because the resolved `docDir` for the broken layers (`domain-model/`, `tests/`, `infrastructure/`) does **not exist**, no `gaps.md` is written for them — even though they report the largest gaps. Only `database` (whose folder name happens to match) got a `gaps.md`. So the "verify → complete → re-verify until 100%" loop (uw-analyze Step 7) **never converges** for domain/tests/infrastructure: nothing to feed `uw-complete`, and the coverage never moves.

## Suggested fixes

1. **Single source of truth for layer→folder.** Export `LAYER_DOC_DIR` (or a `docDirForLayer(layer)` helper) from `@unwind/core` and have BOTH the `uw-analyze` dispatch template and the specialist sub-skills resolve the output folder through it. The orchestrator's `docs/unwind/layers/[layer]/` should be `docs/unwind/layers/{LAYER_DOC_DIR[layer]}/`, not the raw seed key.
2. **Model the tests fan-out explicitly.** Either (a) have the scanner/seed emit `unit-tests` / `integration-tests` / `e2e-tests` sub-layers, or (b) make `LAYER_DOC_DIR.tests` a list and have `verify-coverage` union the markdown across all three folders when verifying the `tests` candidate set.
3. **Give `infrastructure` an analysis path** — add a `uw-analyze-infrastructure` specialist and a Step-2 phase for it, OR exclude `infrastructure` from the verified candidate set (and from `LAYER_DOC_DIR`) if it is intentionally out of scope, so it stops counting as a permanent 0% gap.
4. **Relax `file:` pseudo-item matching** (Bug 4) so single-class files don't show phantom gaps.
5. **Defensive check:** when `verify-coverage` computes 0% for a layer whose seed is non-empty AND the resolved `docDir` does not exist, emit an explicit warning (e.g. `"domain: doc dir layers/domain-model/ not found — did the specialist write to a different folder?"`) instead of silently reporting 0%. A missing folder and a genuinely undocumented layer are different failure modes and should not look identical.

## Resolution (2026-06-23)

Fixed upstream in the plugin source (all four bugs + the secondary effect):

1. **Single source of truth.** `@unwind/core` now owns the layer→folder mapping
   as `LAYER_DOC_DIRS` (layer → *list* of folders) plus `docDirsForLayer()` /
   `primaryDocDir()` helpers (`packages/core/src/layers/rebuild-layer-map.ts`,
   exported from the barrel). `_core.mjs` no longer hardcodes the map; both
   `verify-coverage.mjs` and `build-graph.mjs` consume the core helpers. (Bug 1)
2. **Dispatch resolves the folder deterministically.** `seed-layers.mjs` writes a
   `docDir` field into each seed JSON, and the `uw-analyze` orchestrator template
   now uses `[docDir]` (the seed's field) instead of the underspecified `[layer]`.
3. **Tests fan-out modeled — verifier AND seeder.** `tests → [unit-tests,
   integration-tests, e2e-tests]`; `verify-coverage` unions the markdown across all
   three folders for the single `tests` candidate set. `seed-layers` now also
   **splits** the one `tests` candidate set into three docDir-named seeds
   (`unit-tests.json` / `integration-tests.json` / `e2e-tests.json`) via a
   deterministic `classifyTestKind()` in core, so each test specialist receives
   only its own checklist instead of all three sharing one `tests.json`. Empty
   groups are omitted. A split misclassification is non-fatal — coverage verifies
   the unified layer, so an item just shifts which specialist documents it. (Bug 2)
4. **Infrastructure has an analysis path.** Added `skills/uw-analyze-infrastructure/`
   and a Step-2 dispatch phase in `uw-analyze`. (Bug 3)
5. **`file:` no longer double-counts.** `computeLayerCoverage` treats a `file:`
   candidate as covered when any symbol of that file is documented (fix is in
   `coverage.ts`, *not* `candidates.ts` — the graph relies on a file node existing
   per file for `contains`/`imports` edges). (Bug 4)
6. **Defensive warning.** `verify-coverage` emits an explicit "no doc dir found"
   warning when a non-empty layer has no folder on disk, so a folder-name mismatch
   can't masquerade as a silent 0% again.

Verified end-to-end on synthetic fixtures: domain (`domain-model/`), tests
(`unit-tests/`), and infrastructure (`infrastructure/`) all now resolve to
**100%**; the `tests` layer fans out into three docDir-named seeds (unit /
integration / e2e) routed by `classifyTestKind`; `build-graph` keeps its file
nodes + containment edges. Core test suite (39 tests) green, including new
regression tests for the doc-dir helpers, the `file:` fallback, and the test-kind
classifier. Shipped as plugin **0.8.4**.

## Affected files

- `skills/scripts/_core.mjs` (`LAYER_DOC_DIR`, lines ~36–46)
- `skills/scripts/verify-coverage.mjs` (folder resolution + gaps.md `existsSync(docDir)` guard)
- `skills/uw-analyze/SKILL.md` (Step 3 dispatch template `Output folder: docs/unwind/layers/[layer]/`; Step 2/4 phase list; missing infrastructure phase)
- `skills/uw-analyze-domain/SKILL.md` (output dir `domain-model/` — correct, but not what the orchestrator emits)
- `skills/uw-analyze-unit-tests/SKILL.md` (+ integration/e2e siblings) — `unit-tests/` vs verifier's `tests/`
- (missing) `skills/uw-analyze-infrastructure/SKILL.md`
