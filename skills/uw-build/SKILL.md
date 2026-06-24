---
name: uw-build
description: Use after unwind:uw-plan to EXECUTE the rebuild — interview the user about scope/order/target, dispatch technology-agnostic per-layer builder agents that reproduce the [MUST] contracts in the target stack, hold rebuild state in a local file, and maintain a source→target verification graph that measures completeness. Supports a loop-until-verified mode.
uses-skills:
  - unwind:uw-build-layer
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git:*, mkdir:*, ls:*, cat:*)
  - Bash(node:*)
  - Bash(pnpm:*)
  - Bash(source:*)
  - Read(docs/unwind/**)
  - Write(docs/unwind/**)
  - Edit(docs/unwind/**)
  - Task
  - AskUserQuestion
---

# Executing the Rebuild

Turn the rebuild **spec** (layer docs + `REBUILD-PLAN.md`) into actual code in the
target stack, and **measure** how faithfully it carried over. The differentiator:
completeness is verified by re-scanning the rebuilt repo and diffing it against the
source graph — a before/after picture — not asserted.

**Requires:** a completed plan — `docs/unwind/REBUILD-PLAN.md` +
`docs/unwind/.cache/rebuild-decisions.json` + `docs/unwind/rebuild-graph.json` +
`docs/unwind/layers/**`. (Run `uw-plan` and `uw-graph`/`uw-dashboard` first.)
**Produces:**
- Target-stack code in the chosen target repo (via builder subagents).
- `docs/unwind/.cache/rebuild-state.json` — the durable rebuild ledger (resume + loop).
- `docs/unwind/.cache/rebuild-map/<sliceId>.json` — per-slice source→target mappings.
- `docs/unwind/.cache/rebuild-progress.json` — overlay the dashboard renders.
- `docs/unwind/rebuild-verification-graph.json` + `docs/unwind/rebuild-gaps.md`.

**Principles:** builders follow `rebuild-principles.md` (functional equivalence,
`[MUST]` inviolable, record every mapping, never silently skip).

> **Hybrid / graceful fallback:** with `@unwind/core` available, the rebuilt target
> is re-scanned and completeness is *measured*. Without it (no Node/pnpm/core), the
> builders still run from the docs and the orchestrator records state in plain JSON,
> but there is **no verification graph** — completeness is LLM-asserted; say so.

---

## Phase A — Read the plan (deterministic intake)

Bootstrap the plugin + core, then read the decided strategy. **Most of the "how" is
already decided in the plan — apply the escape hatch and don't re-ask it.**

```bash
# Locate the installed Unwind plugin, then load the core helper.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || echo "core unavailable — pure-LLM build, no verification graph"
```

Read and hold in mind:
- `docs/unwind/REBUILD-PLAN.md` — target stack, phasing order, re-use decisions.
- `docs/unwind/.cache/rebuild-decisions.json` — the machine-readable decisions
  (target language/framework/datastore/ORM, API style, hosting, …). **Note whether
  the API contract style changed** (REST→tRPC/GraphQL) — it affects verification.
- `docs/unwind/rebuild-graph.json` — the source nodes (id, layer, `[MUST]/[SHOULD]/
  [DON'T]` priority, contractKind) you will rebuild and verify against.
- The layer docs under `docs/unwind/layers/**` — the per-item specifications.

Derive the **slice list**: one slice per present layer, in dependency order
(`database → domain → service → api → messaging → frontend → tests →
infrastructure`), seeded by the plan's phasing. Each slice's `[MUST]` source nodes
come from `rebuild-graph.json` (filter by `layer`, drop `priority: "DON'T"`).

---

## Phase B — Grill (the build interview)

Ask **only the genuinely-new decisions** the plan didn't answer, one per
`AskUserQuestion` call, recommended-first. Skip anything the plan/decisions already
fix. Offer **"Accept recommended defaults"** in the first question for a one-shot.

1. **Scope** — *one slice* / *one phase* / *whole rebuild*. (Recommended: start with
   one slice — the foundational layer — to validate the loop before committing.)
2. **Target output location** — the directory/repo where rebuilt code goes, and
   whether to **scaffold** the project skeleton first (package manifest, framework
   bootstrap) per the target stack.
3. **Verification depth** — *structural + contract diff* (recommended; deterministic
   presence + endpoint/table diff) / *+ run target tests* (heavier; needs the rebuilt
   app runnable).
4. **Execution mode** — *step-through* (gate after each slice) / *loop until
   verified* (self-paced; see **Loop mode**). Recommended: step-through for the first
   slice, then loop once the pattern is proven.
5. **First slice** (slice mode) — default the foundational layer from phasing.
6. If `rebuild-state.json` already exists: **resume** (recommended) vs **restart**
   (destructive — requires explicit confirmation before deleting state/maps).

> **Warn at interview time** if the target language is outside tree-sitter contract
> extraction (TypeScript/JavaScript, Python, Rust, Java, C#): verification will be
> **file-grain only** (presence, not contract diff). Set expectations now so a
> later "low %" isn't a surprise.

### Initialize the state ledger

Write `docs/unwind/.cache/rebuild-state.json` from the interview answers (the schema
is validated by the scripts, so a malformed write is caught immediately):

```jsonc
{
  "version": "1.0.0",
  "generatedAt": "<ISO>", "updatedAt": "<ISO>",
  "targetRoot": "<chosen target dir>",
  "config": {
    "scope": "one-slice|one-phase|whole",
    "verificationDepth": "structural|contract-diff|run-tests",
    "executionMode": "step-through|loop",
    "sliceOrder": ["database", "domain", "service", "api", "..."],
    "scaffolded": false
  },
  "nodes": {},     // filled by merge-rebuild-map as builders report mappings
  "slices": {}     // filled as slices are built/verified
}
```

In **loop mode** also add:
`"loopState": { "enabled": true, "targetPct": 100, "dryRounds": 0, "lastCompletenessPct": 0, "lastSliceId": null }`.

If restarting: after explicit confirmation, delete `rebuild-state.json`,
`rebuild-map/`, `rebuild-verification-graph.json`, `rebuild-gaps.md`,
`rebuild-progress.json` — and **only** those. Never touch the target code without
asking.

---

## Phase C — Build loop (per slice)

For each slice in `sliceOrder` (bounded by `scope`):

### 1. Dispatch the builder

Read the slice's seed (`docs/unwind/.cache/seeds/{layer}.json`) and dispatch the
generic builder, pasting the decided stack + the seed + the layer + the spec path:

```
Task(subagent_type="general-purpose")
  description: "Build [layer] slice"
  prompt: |
    Use unwind:uw-build-layer to rebuild this slice in the target stack.

    sliceId: [layer]
    targetRoot: [targetRoot from rebuild-state.json]
    layer: [layer]   (selects the contract-preservation section)

    ## Target stack (from REBUILD-PLAN.md / rebuild-decisions.json)
    [paste the decided language, framework, datastore, ORM, etc.]

    ## Spec docs for this slice
    docs/unwind/layers/[docDir]/   (read these — they are the authority)

    ## Candidate checklist (your [MUST] list)
    [paste docs/unwind/.cache/seeds/[layer].json]

    Build idiomatic target-stack code under targetRoot for every [MUST] (and clean
    [SHOULD]); skip [DON'T]. Then WRITE the mapping file
    docs/unwind/.cache/rebuild-map/[layer].json (see rebuild-principles.md §3) using
    the verbatim sourceId and target ids computed against the files you wrote. Never
    map an item to code you didn't write. Report what you built and any [MUST] you
    could not build (leave it unmapped — it surfaces as a gap).
```

Dispatch slices in **dependency order** — wait for a layer before the layers that
depend on it (same rule as `uw-analyze`). Independent slices (e.g. tests, infra) may
go in parallel.

### 2. Merge → scan → verify

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/merge-rebuild-map.mjs" "$(pwd)"
node "$UNWIND_PLUGIN_ROOT/skills/scripts/verify-rebuild.mjs" "$(pwd)"
```

`merge-rebuild-map` ingests the per-slice maps into `rebuild-state.json` and derives
`rebuild-progress.json`. `verify-rebuild` re-scans the target (into an isolated
`.cache/target-scan/` so the source baseline is never clobbered), writes
`rebuild-verification-graph.json` + `rebuild-gaps.md`, promotes built nodes to
`verified`/flags `divergent`, and prints the completeness %.

### 3. Inner gap-closing loop

Read `rebuild-gaps.md` / the verification stats. If the slice's `[MUST]` completeness
is below target **and the last round made progress**, re-dispatch the builder for
that slice pointed at `rebuild-gaps.md` (it merges fixes into the existing mapping),
then repeat step 2. Stop the inner loop when the slice hits target or a round makes
**no** progress (a stuck slice — surface it; don't spin). This mirrors `uw-analyze`'s
verify→complete loop and converges because the diff is deterministic.

### 4. Advance

- **Step-through mode:** use `AskUserQuestion` to gate — continue to the next slice,
  or pause. Report the slice's completeness and any gaps.
- **Loop mode:** advance per **Loop mode** below.

---

## Loop mode (build until verified)

Run `uw-build` under the harness **`/loop`** skill, self-paced (no interval →
the model paces itself; the loop ends when it stops scheduling the next iteration):

```
/loop /uw-build
```

Each iteration does **one in-scope slice**, then decides — using the *measured*
number, never a feeling:

1. Read `rebuild-state.json` (the durable handoff) → pick the next slice whose status
   isn't `built`/`verified` (or has `needs-recheck` nodes).
2. Run Phase C steps 1–3 for that slice.
3. Read `rebuild-verification-graph.json.stats.completenessPct` (over in-scope
   `[MUST]`). Update `loopState`: set `lastCompletenessPct`; if it did **not**
   increase vs the previous iteration, `dryRounds++`, else reset `dryRounds = 0`.
4. **STOP the loop** (do not schedule another iteration; report) when:
   - `completenessPct >= loopState.targetPct` (default 100% of in-scope `[MUST]`), OR
   - `dryRounds >= 2` (stuck — escalate to the user with the gaps), OR
   - an error or a genuine new decision the plan didn't answer arises.
   Otherwise continue the loop.

The `dryRounds` counter lives in `rebuild-state.json`, so even a fresh iteration that
starts cold (after context compaction) cannot spin forever.

---

## After completion — report

Announce what was produced and the headline number:
> Rebuild slice(s) complete. Completeness: **N%** of in-scope `[MUST]` items present
> or equivalent (`rebuild-verification-graph.json`). Remaining gaps:
> `docs/unwind/rebuild-gaps.md`. Progress overlays the dashboard via
> `rebuild-progress.json`.

Remind that `present` ≠ `correct` — structural presence doesn't prove behavior; for
behavioral equivalence use run-tests depth / the project's equivalence vectors.

**Use AskUserQuestion** for the next step:
- **Open the dashboard** — `unwind:uw-dashboard` (shows rebuild status on the graph).
- **Continue the rebuild** — next slice/phase (or `/loop /uw-build`).
- **Pause here.**

> **Pipeline:** scan → analyze → plan → **build ✓** → dashboard.

## Refresh interaction

After source code changes, `uw-refresh` flags changed contracts. On the next
`uw-build` run, `merge-rebuild-map` reads `changes.json` and flips affected
`done`/`verified` nodes to `needs-recheck`, so loop mode naturally re-builds the
slices whose source moved. No parallel mechanism — the same `changes.json` drives both.
