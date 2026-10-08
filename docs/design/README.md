# Unwind design: Rewind · Spec · Play

> **In short:** This folder describes where Unwind is heading and how we get there. Unwind splits into **Rewind**, which understands a legacy system and compiles it into a stack-neutral **Spec**, and **Play**, which rebuilds the Spec deterministically from a client's **Target Kit** of recipes, with an LLM filling the explicit holes. Both halves are verified by computation, not by assertion. The ideas borrow heavily from OpenRewrite/Moderne, but Unwind takes **no dependency** on their stack.

**Status:** design, for review. Nothing here is built yet. Live HTML version: https://unwind-design.cliftonc.nl

![The big picture: Rewind → Spec → Play → Target, verified](diagrams/01-big-picture.svg)

## One-page summary

**Where Unwind is today.** Unwind is a Claude Code plugin with this pipeline:
1. deterministic scripts (`@unwind/core`, tree-sitter) inventory a codebase;
2. LLM specialists write `[MUST]`/`[SHOULD]`/`[DON'T]`-tagged layer docs;
3. coverage is proven by set arithmetic (`manifest − docs`);
4. `uw-grill` attacks the business logic;
5. `uw-plan` interviews the user;
6. `uw-build` has LLM subagents write the target code, which `verify-rebuild` re-scans and diffs.

Every line of target code is still written by an LLM. The extracted facts are names only: no types, no call graph.

**What we learned from OpenRewrite/Moderne** ([01](01-review-openrewrite.md)):
- Their **Lossless Semantic Tree** (type-attributed, built by the real compiler) and their **recipe** model (scan → generate → edit, declarative composition, before/after golden tests, data tables) are excellent ideas.
- But OpenRewrite performs **no cross-language translation**. Its non-JVM languages and most recipe packs are under a source-available licence (MSAL) or are proprietary, and they run through a JVM host and the Moderne CLI.
- **Decision: we copy the concepts and depend on none of the code.**

**The destination** ([02](02-architecture.md)):
- **`@unwind/model`** is the shared contract: ids, Semantic Model, Spec, Kit and verification schemas.
- **Rewind** (understand) covers scan, typed Semantic Model, tagged docs, grill and context gaps, and produces the **Spec**: a typed, stack-neutral IR of entities, endpoints, events, config and operations, each carrying priority and provenance.
- **Play** (rebuild) takes a Spec plus a **Target Kit** and runs recipes and blueprints to generate code. The LLM fills the `@unwind-hole`s, then verification runs: structural, typed and behavioural.
- **Target Kits** are versioned per-client git repos encoding their golden path. They are mined primarily from the client's own reference app ([03](03-target-kits-and-recipes.md)).
- **Behaviour parity** ([05](05-behaviour-parity.md)): scenarios generated from the Spec run against the legacy app (to observe it and enrich the Spec) and against the rebuild (to give a parity verdict).
- **Context gaps** ([05b](05b-context-gaps.md)): an agent round finds what the code can't tell us and produces interview briefs for stakeholders, end users, developers and ops. The answers flow back into the Spec with provenance.
- **Surfaces:** one engine with a **CLI first** (the skills shell out to it), plus, **from day 0**, a self-hosted **Unwind Server** ([08](08-server-and-slices.md)).
  - The server is the team's shared system of record, with a basic UI: Hono + React, git + SQLite, one Docker image.
  - Developers `unwind login` with a simple token and **push artifacts only**; code stays local.
  - **Slices** are first-class units of work. They are analyzed in parallel, **converged** into one project Spec, and later rebuilt strangler-style by Play.
  - An MCP adapter follows later.

**How we get there** ([06](06-roadmap.md)): phases 0–8 (with 5b–5d in parallel), each shippable on its own, each keeping the graceful fallback to today's pure-LLM flow.

## Reading order

| # | Doc | Read it if you want… |
|---|---|---|
| 01 | [Review: OpenRewrite / Moderne vs Unwind](01-review-openrewrite.md) | what we looked at, what we borrow, and why there is no dependency |
| 02 | [Destination architecture](02-architecture.md) | the whole picture: Rewind / Spec / Play / Kits / surfaces |
| 03 | [Target Kits, recipes, blueprints, holes](03-target-kits-and-recipes.md) | how the target becomes deterministic |
| 04 | [Semantic Model and store](04-semantic-model.md) | the LST-inspired typed model behind Rewind |
| 05 | [Behaviour parity](05-behaviour-parity.md) | tests that run against both the legacy app and the rebuild |
| 05b | [Context gaps and interviews](05b-context-gaps.md) | finding and closing gaps the code can't answer |
| 06 | [Roadmap](06-roadmap.md) | the phased plan with exit criteria |
| 07 | [Open questions](07-open-questions.md) | decisions still to make, each with a recommendation |
| 08 | [Unwind Server and slices](08-server-and-slices.md) | the shared day-0 server, auth, push/pull, slices and convergence |

## How to review

- Sections are numbered (`§3.4`, `§05b.2`). Cite them in offline comments.
- The markdown here is the source of truth. The HTML site is generated from it.
- Conventions every proposal must respect come from the repo's `CLAUDE.md`:
  - the manifest schema is **additive-only**;
  - **AST/real parsers over regex**;
  - **graceful fallback** when Node/core is unavailable;
  - **candidate ids** are the join key.

  A proposal that bends one of these says so explicitly.
