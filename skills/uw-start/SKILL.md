---
name: uw-start
description: Start here. The entry point for reverse-engineering a codebase with Unwind — orients you, checks prerequisites, handles restart vs update, then runs the rebuild pipeline (scan → analyze → plan → dashboard) with a checkpoint at each phase. Use when beginning Unwind on a repo, or when unsure which uw- skill to run first.
allowed-tools:
  - Read
  - Glob
  - Bash(git:*, ls:*, node:*, pnpm:*, source:*)
---

# Start Here — Unwind

The front door. This skill orients the user and drives the pipeline by **delegating
to the phase skills** — it does not re-implement them. Each phase ends with its own
continue/pause gate, so you stay in control.

## What Unwind does (say this to the user)

> Unwind reverse-engineers this codebase into a **rebuild spec** — enough to rebuild
> it in a different stack while preserving the data model, API contracts, and business
> logic. Every documented item is tagged `[MUST]` / `[SHOULD]` / `[DON'T]`, and
> completeness is **verified by set arithmetic** (scan − docs), not asserted.
>
> **Pipeline:** scan → analyze → plan → dashboard. We checkpoint at each phase.

## Step 1: Preconditions

```bash
git rev-parse --is-inside-work-tree 2>/dev/null && echo "git: yes" || echo "git: no (local mode — source links degrade, still works)"
command -v node >/dev/null && command -v pnpm >/dev/null && echo "node+pnpm: yes" || echo "node/pnpm: missing (falls back to the legacy pure-LLM flow)"
pwd   # confirm this is the repo to analyze
```

- **git** is recommended (drives `link_format` for source links); without it Unwind
  runs in local mode with degraded links.
- **node + pnpm** enable the deterministic scanner (`@unwind/core`). If missing,
  every skill degrades gracefully to the pure-LLM flow.
- Confirm `pwd` is the project root you intend to analyze.

## Step 2: Fresh run or existing analysis?

```bash
ls docs/unwind/layers/*/ >/dev/null 2>&1 && echo "EXISTING analysis found" || echo "fresh run"
```

- **Fresh run** → continue to Step 3.
- **Existing analysis** → tell the user one exists. The restart-vs-update decision is
  handled by `uw-analyze` (its Step 0 pre-gate): **Update (refresh, non-destructive)**
  or **Restart from scratch** (deletes prior docs, requires explicit confirmation).
  Don't delete anything here — let `uw-analyze` own that gated decision.

## Step 3: Choose the run mode

**Use AskUserQuestion** to ask how they want to proceed:

- **Step through with checkpoints** *(recommended)* — run one phase at a time; at each
  phase's gate, the user decides whether to continue or pause.
- **Run straight to the dashboard** — proceed scan → analyze → plan → dashboard
  without pausing at the gates. Still honor the restart-from-scratch confirmation
  (never auto-delete) and stop on any error.

## Step 4: Kick off

Invoke the first phase now — **`unwind:uw-scan`** — and then follow the pipeline:

| Phase | Skill | Produces |
|-------|-------|----------|
| 1. Scan | `unwind:uw-scan` | `architecture.md` + `.cache/scan-manifest.json` |
| 2. Analyze | `unwind:uw-analyze` | `layers/**` (seeded, verified to 100%) |
| 3. Plan | `unwind:uw-plan` | `REBUILD-PLAN.md` (interviews you about target stack, re-use & phasing) |
| 4. Dashboard | `unwind:uw-dashboard` | builds `rebuild-graph.json` + launches the viewer |

- **Step-through mode:** invoke `unwind:uw-scan`, then act on each phase's
  continue/pause prompt as the user answers it.
- **Run-to-dashboard mode:** invoke each phase in turn, auto-continuing at the gates,
  until the dashboard launches — pausing only for the restart confirmation, the
  **plan interview** (target stack and re-use are user decisions; `uw-plan` lets you
  one-shot them via "accept all recommended defaults"), or errors.

`unwind:uw-graph` is an **optional export** (raw `rebuild-graph.json` without a
server, for static deploy / CI / sharing) — not a required phase; the dashboard
builds the graph itself.

## Notes

- After code changes later, run `unwind:uw-refresh` (incremental) or just re-open
  `unwind:uw-dashboard` (it rebuilds the graph from the current scan + docs).
- For the full skill index, see `unwind:uw-help`.
