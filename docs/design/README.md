# Unwind design: Rewind · Spec · Play

> **In short:** This folder describes where Unwind is heading and how we get there. Teams work on a large codebase through a shared, self-hosted **Unwind Server**, splitting it into **slices**. Unwind splits into **Rewind**, which understands a legacy system and compiles it into a stack-neutral **Spec**, and **Play**, which rebuilds the Spec deterministically from a client's **Target Kit** of recipes, with an LLM filling the explicit holes. The CLI does the work next to the code and pushes artifacts (never code) to the server, which stores them, converges slice Specs into one project Spec and shows progress. Both halves are verified by computation, not by assertion. The ideas borrow heavily from OpenRewrite/Moderne, but Unwind takes **no dependency** on their stack.

**Status:** design, for review. Nothing here is built yet. Live HTML version: https://unwind-design.cliftonc.nl

![The big picture: Unwind Server as the shared backbone · Rewind → Spec → Play → Target, verified per slice](diagrams/01-big-picture.svg)

## One-page summary

**Where Unwind is today.** Unwind is a Claude Code plugin with this pipeline:
1. deterministic scripts (`@unwind/core`, tree-sitter) inventory a codebase;
2. LLM specialists write `[MUST]`/`[SHOULD]`/`[DON'T]`-tagged layer docs;
3. coverage is proven by set arithmetic (`manifest − docs`);
4. `uw-grill` attacks the business logic;
5. `uw-plan` interviews the user;
6. `uw-build` has LLM subagents write the target code, which `verify-rebuild` re-scans and diffs.

Every line of target code is still written by an LLM. The extracted facts are names only: no types, no call graph.

**Prior art.** OpenRewrite/Moderne ([01](01-review-openrewrite.md)) contributes the *semantic model and recipe* ideas. Anthropic's code-modernization plugin ([01b](01b-compare-code-modernization.md)) contributes the *proof discipline* (canary, comparator self-check, fresh inputs, PROVEN / PARTLY / NOT verdicts), rule cards with adversarial review, preflight, and pilot → playbook fan-out.

**What we learned from OpenRewrite/Moderne** ([01](01-review-openrewrite.md)):
- Their **Lossless Semantic Tree** (type-attributed, built by the real compiler) and their **recipe** model (scan → generate → edit, declarative composition, before/after golden tests, data tables) are excellent ideas.
- But OpenRewrite performs **no cross-language translation**. Its non-JVM languages and most recipe packs are under a source-available licence (MSAL) or are proprietary, and they run through a JVM host and the Moderne CLI.
- **Decision: we copy the concepts and depend on none of the code.**

**The flow, end to end** ([02 §2.1](02-architecture.md)):
1. A team stands up the **Unwind Server** ([03](03-server-and-slices.md)), creates a project, and developers `unwind login` with a simple token.
2. The codebase is scanned once locally; the server proposes **slices** (units of work) and people or agents claim them.
3. Each slice is analysed locally with **Rewind** (scan → tagged docs → grill → context gaps → parity observations); the CLI **pushes artifacts per slice**. Source code never leaves the developer's machine.
4. The server **converges** slice Spec fragments into one project **Spec**, reporting uncovered items, overlaps, conflicts and seams.
5. **Play** rebuilds slice by slice from the Spec plus the client's **Target Kit**; verification results are pushed back, so the server shows completeness and parity per slice.

**The destination** ([02](02-architecture.md)):
- **Unwind Server** (from day 0): the team's shared system of record and UI. Hono + React, git + SQLite, one Docker image; token login; artifacts only; **slices** are first-class and converge into one project Spec ([03](03-server-and-slices.md)).
- **`@unwind/model`** is the shared contract: ids, Semantic Model, Spec, Kit and verification schemas.
- **Rewind** (understand) covers scan, typed Semantic Model, tagged docs, grill and context gaps, and produces the **Spec**: a typed, stack-neutral IR of entities, endpoints, events, config and operations, each carrying priority and provenance.
- **Play** (rebuild) takes a Spec plus a **Target Kit** and runs recipes and blueprints to generate code. The LLM fills the `@unwind-hole`s, then verification runs: structural, typed and behavioural.
- **Target Kits** are versioned per-client git repos encoding their golden path. They are mined primarily from the client's own reference app ([04](04-target-kits-and-recipes.md)).
- **Behaviour parity** ([06](06-behaviour-parity.md)): scenarios generated from the Spec run against the legacy app (to observe it and enrich the Spec) and against the rebuild (to give a parity verdict).
- **Context gaps** ([07](07-context-gaps.md)): an agent round finds what the code can't tell us and produces interview briefs for stakeholders, end users, developers and ops. The answers flow back into the Spec with provenance.
- **Surfaces:** one engine with a **CLI first** (the skills shell out to it; it works offline and pushes to the server when logged in), the **server** for shared state and UI, and an MCP adapter later.

**How we get there** ([08](08-roadmap.md)): phases 0–8 (with 5b–5d in parallel), each shippable on its own, each keeping the graceful fallback to today's pure-LLM flow.

## Reading order

| # | Doc | Read it if you want… |
|---|---|---|
| 01 | [Review: OpenRewrite / Moderne vs Unwind](01-review-openrewrite.md) | what we looked at, what we borrow, and why there is no dependency |
| 01b | [Comparison: Anthropic's code-modernization plugin](01b-compare-code-modernization.md) | the closest prior art, side by side, and the 17 ideas we borrow (proof discipline, rule cards, preflight, pilot → playbook) |
| 02 | [Destination architecture](02-architecture.md) | the whole picture: server, Rewind / Spec / Play / Kits / surfaces |
| 03 | [Unwind Server and slices](03-server-and-slices.md) | the shared day-0 server, auth, push/pull, slices and convergence |
| 04 | [Target Kits, recipes, blueprints, holes](04-target-kits-and-recipes.md) | how the target becomes deterministic |
| 05 | [Semantic Model and store](05-semantic-model.md) | the LST-inspired typed model behind Rewind |
| 06 | [Behaviour parity](06-behaviour-parity.md) | tests that run against both the legacy app and the rebuild |
| 07 | [Context gaps and interviews](07-context-gaps.md) | finding and closing gaps the code can't answer |
| 08 | [Roadmap](08-roadmap.md) | the phased plan with exit criteria |
| 09 | [Open questions](09-open-questions.md) | decisions still to make, each with a recommendation |

## How to review

- Sections are numbered (`§4.4`, `§7.2`). Cite them in offline comments.
- The markdown here is the source of truth. The HTML site is generated from it.
- Conventions every proposal must respect come from the repo's `CLAUDE.md`:
  - the manifest schema is **additive-only**;
  - **AST/real parsers over regex**;
  - **graceful fallback** when Node/core is unavailable;
  - **candidate ids** are the join key.

  A proposal that bends one of these says so explicitly.
