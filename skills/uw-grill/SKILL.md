---
name: uw-grill
description: Use after coverage reaches 100% and BEFORE unwind:uw-plan, to attack the documented business logic — find rules that shouldn't be rebuilt and specs too thin to rebuild from. Produces a questionnaire for domain experts, ingests their answers, and writes the verdicts back into the layer docs.
uses-skills:
  - unwind:uw-grill-layer
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
  - AskUserQuestion
  - Task
---

# Grilling the Business Logic

**Requires:** layer docs at 100% coverage (`uw-verify` → `uw-complete`)
**Produces:**
- `docs/unwind/questions/*.md` — one questionnaire per business capability
- `docs/unwind/.cache/grill-findings.json` — the machine record
- retagged layer docs, once verdicts land

## Why this exists

Coverage proves every symbol is **described**. It proves nothing about whether the
described behaviour is worth reproducing. A workaround for a vendor bug in 2019, a
hardcoded 8-hour working day, a query missing its tenant filter — all of these pass
at 100% coverage and get faithfully rebuilt into the new stack.
`rebuild-principles.md` §8 already concedes the limit: structural verification
proves the routing surface and the data-model shape, never behaviour.

**And you cannot close that gap yourself.** Whoever runs Unwind is an engineer
doing archaeology on someone else's code. They do not know whether an 8-hour day is
still contractually right. Asking them produces confident guesses, which is worse
than no answer.

So this skill sorts findings by **who can actually answer them**. The ones the
codebase can settle, it settles. The rest become a document, written in business
English, that goes to the people who know.

## Two passes

The skill detects which pass it is on:

```bash
ls docs/unwind/questions/*.md >/dev/null 2>&1 && echo "questionnaire exists" || echo "first pass"
```

- **No questionnaire** → Pass 1 (Phases A–D): explore, triage, ask, emit.
- **Questionnaire exists** → Pass 2 (Phases E–F): ingest answers, write back.
  Offer to re-run the exploration only if the user asks.

---

## Phase A — Brief (deterministic intake)

```bash
# Locate the installed Unwind plugin, then load the core helper.
# $0/BASH_SOURCE are unreliable under `bash -c`, so glob the install cache.
UNWIND_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${UNWIND_PLUGIN_ROOT:-}}"
[ -f "$UNWIND_PLUGIN_ROOT/skills/scripts/_resolve-plugin-root.sh" ] || \
  UNWIND_PLUGIN_ROOT="$(ls -dt "$HOME"/.claude/plugins/cache/*/unwind/*/ 2>/dev/null | head -1)"
source "${UNWIND_PLUGIN_ROOT%/}/skills/scripts/_resolve-plugin-root.sh"
ensure_unwind_core || echo "core unavailable — using legacy artifact reading"
node "$UNWIND_PLUGIN_ROOT/skills/scripts/grill-brief.mjs" "$(pwd)"
```

Writes `docs/unwind/.cache/grill-brief.json` and one seed per deep layer under
`.cache/grill/seeds/`. **Read the brief.** It contains:

- `conventions` — which signals are trustworthy *in this repo*. Critically,
  `testConventionReliable`: `tested_by` is a filename-stem convention, so a repo
  with feature-named suites looks entirely untested. When it is false the untested
  bucket is **suppressed**, and you must say so rather than report it.
- `thresholds` — computed as percentiles of this repo, not hardcoded. Report them,
  so a reader can audit why an item was flagged.
- `perLayer[]` — `mode` (`deep`/`shallow`), `budget`, `hotspots`, `mustSurface`.
- `buckets` — the ranked hotspot lists, each entry naming the signal behind it.
- `capabilityCandidates[]` — deterministic *proposals* for business capabilities.

**Graceful fallback:**
- Script exits non-zero → read `.cache/scan-manifest.json` and `.cache/coverage/*.json`
  directly and `grep` the tags across `docs/unwind/layers/**`. Say so.
- Artifacts absent → legacy flow: read the layer docs and grill by judgement. Say
  the findings are not reproducible.

Present a short factual summary before going further: `[MUST]` total, the buckets
with counts, which categories are suppressed and why.

---

## Phase B — Explore

Dispatch one `uw-grill-layer` specialist per **deep** layer (`mode: "deep"` in the
brief — normally database, domain, service, api, messaging). Layers marked
`shallow` yield only readiness findings that are already machine-computed; derive
those yourself from the buckets and do **not** spend a subagent on them.

Dispatch in dependency order, parallel within a phase, mirroring `uw-analyze`:
database → domain → service → api|messaging.

```
Task(subagent_type="general-purpose")
  description: "Grill [layer] layer"
  prompt: |
    Use unwind:uw-grill-layer to interrogate this layer.

    ## Your seed
    [paste docs/unwind/.cache/grill/seeds/[layer].json]

    Budget: [budget] findings, hard cap.
    Write findings to docs/unwind/.cache/grill/[layer].json and nothing else.
    Do NOT edit docs/unwind/layers/** — parallel specialists would race.

    Every finding MUST quote real code at a real line, copied from a file you
    actually opened. Findings without evidence are rejected at merge.
```

Then merge deterministically:

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/grill-brief.mjs" "$(pwd)" --merge
```

This validates evidence against the manifest, drops anything unquotable, dedupes,
and assigns stable `GQ-nnnn` ids that survive re-runs. **Report the rejection
count** — it is a quality signal about the exploration, not an embarrassment.

---

## Phase C — Triage by who can answer

> A finding earns a place in the expert questionnaire only if the codebase cannot
> answer it.

That is the grilling rule "if a question can be answered by exploring the
codebase, explore instead", applied mechanically. Split on `answerableBy`:

**`engineer`** (`thin-spec`, `untested-must`, `silent-failure`,
`idempotency-ordering`, `tenancy-scope-gap`) — settle these now. Auto-verdict the
obvious ones and put at most **8** to the user, one per `AskUserQuestion` call,
recommended option first, with **"Accept all recommended"** offered in the first
question. Defaults that need no asking: `thin-spec` → `document-first`,
`untested-must` → `preserve` plus a note that equivalence rests on tests that do
not exist.

**`expert`** (`obsolete-rule`, `unexplained-rule`, `magic-constant`,
`contradiction`, `duplicated-logic-drift`) — these go to the document. Do not
guess them, and do not ask the operator to guess them either.

Also in this phase, confirm the **capability grouping** in one question: show the
proposed names from `capabilityCandidates` with their item counts and let the user
rename, merge, or accept. Domain experts think in capabilities, not layers — the
whole point is that the finance owner receives the billing file and nothing else.

---

## Phase D — Emit the questionnaire

Write one file per capability to `docs/unwind/questions/<capability>.md`, plus a
`README.md` index listing each file, its owner (blank for the user to fill), and
its open count.

**Placement matters.** `verify-coverage`, `plan-brief` and `build-graph` all walk
`docs/unwind/layers/**`. A questionnaire under `layers/` would have its headings
parsed as documented items and inflate coverage. Under `docs/unwind/questions/` it
is inert — and `build-graph.mjs` picks it up into the dashboard's Docs view for
free.

Write for a **non-engineer**. No `[MUST]` tags, no anchor ids, no jargon, no
"candidate". Say what the system does today, why you are asking, and what happens
if they say nothing.

```markdown
# Billing — questions for the rebuild

We are rebuilding this system. Before we do, we need to know which of its current
behaviours are deliberate. **If a question goes unanswered we will rebuild the
behaviour exactly as it is today**, including any mistakes.

Tick one box per question and add anything useful under Notes. Then commit the
file, or leave it on a pull request.

---

### GQ-0007 · Is a working day still 8 hours for everyone?

**Where this happens:** cost calculation, whenever a rate is quoted per hour.

**Why we're asking:** the code fixes a working day at 8 hours, with no setting and
no explanation. Anyone on a different working day is charged differently.

    const hoursPerDay = 8;      // src/calc/builder.ts:185

[View the code](https://github.com/owner/repo/blob/main/src/calc/builder.ts#L185)

**Please tick one:**

- [ ] Correct — 8 hours is right, rebuild it exactly as is
- [ ] Correct today, but it should become a setting
- [ ] Wrong — the right behaviour is in my notes below
- [ ] This rule is obsolete — leave it out of the rebuild
- [ ] I don't know — this should go to someone else (say who in the notes)

**Notes:**

<!-- grill: {"id":"GQ-0007","verdicts":["preserve","fix-in-rebuild","fix-in-rebuild","drop","reassign"]} -->
```

Rules for the block:
- The `<!-- grill: ... -->` marker is **mandatory** and must be the last line of
  the block. It is the only machine-readable part; the Nth verdict maps to the Nth
  checkbox.
- Always offer an "I don't know / ask someone else" option mapped to `reassign`.
- When a finding's `confidence` is `low`, say so in the prose: "the scanner
  flagged this by convention rather than by reading it — is it real?"
- Keep the code excerpt to the few lines that matter, indented, with the file and
  line beside it.

Then tell the user what to do next: commit the files, route each to an owner, and
re-run `/uw-grill` once answers come back.

---

## Phase E — Ingest answers (pass two)

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/grill-answers.mjs" "$(pwd)"          # dry run
node "$UNWIND_PLUGIN_ROOT/skills/scripts/grill-answers.mjs" "$(pwd)" --apply  # write
```

Always dry-run first and show the user what would change. The script never
guesses: a question with no tick stays open, and one with **two** ticks stays open
and is reported, because two ticks means the question was wrong.

Report honestly: answered, still open, ambiguous. An unfinished grill that says so
is worth more than one that pretends.

---

## Phase F — Write the verdicts back

This is where the grill actually changes the rebuild. Work serially from the
worklist the ingest step printed — never from your recollection of the interview.

| Verdict | Doc effect |
|---|---|
| `preserve` | tag unchanged; append `**Grill verdict:**` confirming it is deliberate |
| `fix-in-rebuild` | tag unchanged; **write the corrected behaviour into the doc body** |
| `drop` | retag `[MUST]` → `[DON'T]`, plus a **mandatory** rationale line |
| `downgrade` | retag `[MUST]` → `[SHOULD]` with a rationale line |
| `document-first` | add the item to `docs/unwind/layers/{docDir}/gaps.md` for `uw-complete` |
| `reassign` | leave open; record the owner in the questionnaire |

**`fix-in-rebuild` is the point of the whole feature.** The expert's answer is
knowledge that exists nowhere in the codebase. It must go into the layer doc
**body**, because that body is what `uw-build-layer` reads as its specification. A
verdict that only reaches a register reaches nothing.

The `[DON'T]` rationale line is **mandatory, not editorial**. `[DON'T]` otherwise
means "specific to the source stack", so without the line a
dropped-because-obsolete rule is indistinguishable from a dropped-because-Express
one. Write which it is:

```markdown
### applyVat1994 [DON'T] <!-- id: function:src/legacy/vat.ts:applyVat1994 -->

**Grill verdict (GQ-0007): drop.** Superseded by the 2021 VAT rules; the finance
owner confirmed no live customer is on the 1994 basis. Not tech-specific — this
rule is obsolete. Do not reproduce it.
```

### Editing safely

Match the **full heading line including the anchor comment** — it is effectively
unique. Three guards, all of which mean *stop*, not *guess*:

1. An item with no `<!-- id: -->` anchor was fuzzy-matched and has no safe target.
   Report it as inapplicable; never guess which heading was meant.
2. If the heading line matches in more than one file, skip it and report.
3. Before editing, check `git status` on `docs/unwind` and warn if it is already
   dirty, so your changes stay reviewable as their own diff.

**Only the `[MUST]`/`[SHOULD]`/`[DON'T]` token may change.** The anchor id must
survive byte-for-byte — `verify-coverage` matches on it first, and damaging one
silently drops the item from coverage.

### Then prove you didn't break anything

```bash
node "$UNWIND_PLUGIN_ROOT/skills/scripts/verify-coverage.mjs" "$(pwd)"
```

Per-layer coverage percentages **must be unchanged**. This is a real check, not a
ritual: `computeLayerCoverage` matches by id and is tag-agnostic, so a correct
retag cannot move the number. If it drops, you damaged an anchor — fix it before
going on.

Note the *graph* is different, and this is expected: `build-graph.ts` maps
`[DON'T]` to coverage `excluded`, so `rebuild-graph.json` stats will shift after
drops. Say so rather than letting it look like a regression.

---

## How this reaches the rebuild

Nothing new is wired, and that is deliberate. The layer docs are the transport:

- Retagging changes the `[MUST]`/`[SHOULD]`/`[DON'T]` tallies that
  `plan-brief.mjs` already recounts, so `uw-plan` reweights effort and phasing on
  its own.
- `rebuild-principles.md` §2 already forbids porting a `[DON'T]`, so drops are
  honoured by every builder without knowing this skill exists.
- `fix-in-rebuild` corrections live in the doc body, which `uw-build-layer`
  already reads as its spec.

Run `uw-grill` **before** `uw-plan` for this reason: a plan built on rules you were
about to drop is a plan built on sand.

---

## Anti-Patterns

**NEVER:**
1. Put a finding to a domain expert that you could have answered from the code.
2. Emit a question containing `[MUST]`, an anchor id, or a candidate id.
3. Guess a verdict for an unanswered or double-ticked question.
4. Retag without a rationale line.
5. Report a category the brief suppressed.

**ALWAYS:**
1. Quote real code at a real line, in the question itself.
2. Say which fallback tier you are running in.
3. Re-run `verify-coverage` after retagging and assert it is unchanged.
4. Report open questions as open.

---

## Next Step — continue or pause?

**Use AskUserQuestion:**
- **Pass 1 just finished** → **Route the questionnaire** *(recommended)*: commit
  `docs/unwind/questions/`, send each file to its owner, and re-run `/uw-grill`
  when answers land. Or **continue to `unwind:uw-plan`** now and treat the open
  questions as risk carried into the plan.
- **Pass 2 just finished** → **Continue to `unwind:uw-plan`** *(recommended)*, now
  that the tags reflect real decisions. Or **pause**.

Act on the choice in the same turn. If they pause, tell them how to resume: *"Run
`/uw-grill` again to ingest answers, or `/uw-plan` to build the rebuild strategy."*

> **Pipeline:** scan → analyze → verify → complete → **grill ✓** → plan → dashboard.
