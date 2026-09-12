---
name: uw-grill-layer
description: Use when dispatched by unwind:uw-grill to interrogate ONE layer of an already-unwound codebase. Hunts for business-logic flaws and rebuild-readiness gaps, and writes evidence-backed findings — it never edits layer docs and never asks the user anything.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(ls:*, sed:*, grep:*)
  - Write(docs/unwind/.cache/grill/**)
---

# Interrogating One Layer

**Purpose:** find the things a rebuild would faithfully reproduce and shouldn't —
and the things it couldn't reproduce even if it wanted to.

**Input:** `docs/unwind/.cache/grill/seeds/{layer}.json` (pasted by the orchestrator)
**Output:** `docs/unwind/.cache/grill/{layer}.json` — findings only

> **You do not edit layer docs and you do not interview anyone.** Several
> specialists run in parallel; if any of them edited `docs/unwind/layers/**` they
> would race and corrupt the documentation. All mutation happens later, serially,
> in the orchestrator. Write exactly one file: your findings.

## What you are looking for

Coverage already proved every symbol is *described*. You are asking a different
question, and it has two halves:

1. **Does this deserve to be rebuilt?** A rule that was a workaround for a vendor
   bug in 2019 will be lovingly recreated in the new stack unless someone says
   otherwise.
2. **Could this be rebuilt at all?** A `[MUST]` formula documented in one vague
   sentence is a landmine for the builder agent.

## The rule that matters most

**Every finding must quote real code, or it does not exist.**

You are writing questions that will be sent to a domain expert with Unwind's name
on them. One confidently-wrong "you have a tenancy bug" and nobody runs this
again. So:

- `evidence.file` must be a real path from the manifest.
- `evidence.line` must be the real line.
- `evidence.quote` must be **copied from the file you actually read**, not
  reconstructed from memory or from the docs.
- If you cannot quote it, **drop the finding**. A dropped finding costs nothing.

The merge step re-checks all of this against the manifest and silently rejects
anything that fails. Fabricated findings do not reach the user; they just waste
your budget.

## Your budget

The seed carries a `budget`. It is a hard cap on findings, and it exists because a
specialist that returns eighty findings from one layer blows the orchestrator's
context. **Spend it on the highest-severity things you can actually evidence.**
Returning four excellent findings is a better outcome than twelve mediocre ones.

## Process

### Step 1: Read your seed

```
{
  "layer": "service",
  "docDirs": ["service-layer"],
  "budget": 9,
  "thresholds": { "thinBodyLines": 6, "hubIndegreeMin": 3, ... },
  "conventions": { "tenantFields": [...], "testConventionReliable": false, ... },
  "hotspots":    [ ... ],   // where the deterministic signals already point
  "mustSurface": [ ... ]    // the layer's documented [MUST] rules
}
```

- `hotspots` are pre-computed leads, each with the `flags` that earned it a place.
  **Start here.** A hotspot with `flagCount: 3` is where to look first.
- `mustSurface` is the layer's actual rule surface. The correctness categories
  have no deterministic detector, so this is what you read for those.
- `conventions` tells you which signals are trustworthy **in this repo**. If
  `testConventionReliable` is false, the scanner could not tell what is tested —
  do not claim anything is untested.

### Step 2: Read the layer docs, then the source

Read `docs/unwind/layers/{docDir}/**` for what the rules are *said* to be, then
read the source for what they *are*. The gap between those two is where several
categories live.

### Step 3: Hunt, by category

Each finding gets exactly one `category`. Also set `answerableBy`, because it
decides where the question goes: `expert` questions go into a document for a
domain owner, `engineer` questions are settled during the run.

#### Correctness — `answerableBy: "expert"`

| Category | What it looks like |
|---|---|
| `obsolete-rule` | A branch gated on a date, version, feature flag, or a name like `legacy`/`v1`/`old`. Quote the condition and say why it may no longer fire. |
| `unexplained-rule` | A `[MUST]` rule whose *why* is nowhere — not in the code, not in a comment, not in the doc. The rebuild will copy it blindly. |
| `magic-constant` | A hardcoded business value inside a rule: a rate, a cap, a grace period, a working-day length, a rounding step. Not a buffer size or a port number. |
| `contradiction` | Two places assert different things about the same rule, or the doc says one thing and the code does another. Quote **both**. |
| `duplicated-logic-drift` | The same rule implemented twice and diverged. The `duplicateNames` bucket seeds this; confirm by reading both, and quote the difference. |

#### Correctness — `answerableBy: "engineer"`

| Category | What it looks like |
|---|---|
| `tenancy-scope-gap` | A data-access path that omits the tenant key its siblings apply. `conventions.tenantFields` tells you the key. High severity when confirmed. |
| `silent-failure` | A `catch` that returns a business value — a default, an empty list, a zero — instead of propagating. Changes an outcome, not just a log line. |
| `idempotency-ordering` | An at-least-once or retried handler doing something non-idempotent, with no dedupe key. Mostly the messaging layer and POST/PUT handlers. |

#### Readiness — `answerableBy: "engineer"`

| Category | What it looks like |
|---|---|
| `thin-spec` | A `[MUST]` documented too thinly to rebuild from: no formula, no table, no signature, no edge cases. Seeded by the `thin-spec` flag. |
| `untested-must` | A `[MUST]` with no test behind it. **Only when `conventions.testConventionReliable` is true**, and only after you have looked for a test and failed to find one. |

### Step 4: Say no to the rest

Do **not** report: cyclomatic complexity, function length, god classes, naming,
formatting, `TODO` comments, security scanning, dependency versions, performance,
"missing input validation", "inconsistent error types", or "no logging here".

Every one of them is either a linter's job or not business logic, and each
produces hundreds of findings nobody can act on. Reporting them is the fastest way
to get this skill switched off.

### Step 5: Write your findings

Write `docs/unwind/.cache/grill/{layer}.json` — one file, once, at the end.

```json
{
  "layer": "service",
  "generatedAt": "<ISO timestamp>",
  "findings": [
    {
      "category": "magic-constant",
      "severity": "high",
      "confidence": "high",
      "answerableBy": "expert",
      "layer": "service",
      "candidateId": "function:src/calc/builder.ts:computeCost",
      "title": "Working day is hardcoded to 8 hours",
      "detail": "computeCost converts a daily rate to hours using a fixed 8, with no config and no comment. Any customer on a different working day is billed wrongly.",
      "question": "Is a working day 8 hours for every customer, or does it vary?",
      "recommendation": "fix-in-rebuild",
      "evidence": {
        "file": "src/calc/builder.ts",
        "line": 185,
        "quote": "const hoursPerDay = 8;"
      }
    }
  ]
}
```

Field notes:

- `candidateId` — the seed item's `id` when the finding attaches to one, copied
  verbatim (it is the join key into the graph and the dashboard). `null` is fine
  for a rule that has no candidate id; the finding still stands on its evidence.
- `severity` — `high` when a rebuild that got this wrong would be *incorrect*;
  `medium` when it would be *worse*; `low` otherwise. Raise one level for an item
  flagged `hub`, since its blast radius is larger.
- `confidence` — be honest. `low` is a useful answer, and the question will be
  framed to the reader as uncertain rather than asserted.
- `question` — plain business English, no jargon, no `[MUST]`, no file paths. A
  finance manager has to be able to answer it. Write "is a working day still 8
  hours?", never "is the hoursPerDay constant in computeCost still valid?".
- `recommendation` — your best guess at the verdict: `preserve`, `fix-in-rebuild`,
  `drop`, `downgrade`, or `document-first`. It becomes the pre-selected option.

## Anti-Patterns

**NEVER:**
1. Report a finding you cannot quote from source you actually opened.
2. Edit anything under `docs/unwind/layers/` — you will corrupt a parallel run.
3. Exceed your budget.
4. Report style, complexity or lint issues.
5. Claim something is untested when `testConventionReliable` is false.

**ALWAYS:**
1. Quote real code at a real line.
2. Write the `question` for a non-engineer.
3. Prefer fewer, better-evidenced findings.
4. Set `confidence: "low"` rather than dropping a real but unproven concern.
