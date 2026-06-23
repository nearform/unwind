# CLAUDE.md

Guidance for working in this repo.

## What Unwind is

A Claude Code plugin that **reverse-engineers a codebase so an AI agent can rebuild
it in a different stack**, preserving API contracts, business logic, and the data
model. Its differentiator: every documented item is tagged `[MUST]` / `[SHOULD]` /
`[DON'T]` for rebuild prioritization.

Unwind is **hybrid**: deterministic scripts (`@unwind/core`, tree-sitter) own the
verifiable facts (file inventory, structural symbols, contracts, import graph,
layer assignment); LLM sub-agents add the semantic rebuild docs. Completeness is
then **verified by set arithmetic** (`scan − docs`), not asserted. Every script
**degrades gracefully** — if Node/pnpm/core is unavailable, skills fall back to the
legacy pure-LLM flow and say so.

## Repo layout

```
.claude-plugin/         plugin.json + marketplace.json (manifests stay at root)
packages/
  core/                 @unwind/core — the deterministic engine (TypeScript → dist/)
    src/
      scan/             enumerate (git ls-files + walk), language/category tables, repo-info
      structure/        tree-sitter plugin + per-language extractors (ts/js, python, rust, java, c#)
      imports/          internal import-map resolution
      layers/           rebuild-layer-map (file → layer) + contract-detectors (tables/endpoints)
      fingerprint/      structural + content fingerprints (incremental updates)
      manifest/         scan-manifest schema, build-manifest, candidates (shared id scheme)
      graph/            coverage diff, rebuild-graph schema + build-graph
      index.ts          public barrel (export blocks grouped by increment)
  dashboard/            @unwind/dashboard — React + React Flow + ELK (Vite), consumes rebuild-graph.json
skills/
  scripts/              bundled .mjs the skills invoke (scan, seed-layers, verify-coverage,
                        build-graph, detect-changes) + _core.mjs + _resolve-plugin-root.sh
  *                     markdown skills (uw-scan, uw-analyze, uw-analyze-* layer
                        specialists, uw-verify, uw-complete, uw-plan, uw-graph,
                        uw-dashboard, uw-refresh, uw-help, analysis-principles)
```

`dist/` and `*.tsbuildinfo` are gitignored — the core is **lazily built on first
use** (`ensure_unwind_core`). `pnpm-lock.yaml` IS committed. We standardize on pnpm.

## The pipeline (see README + docs/pipeline.svg)

`scan.mjs` → **scan-manifest.json** (ground truth) → `seed-layers.mjs` → per-layer
candidate checklists → LLM layer specialists write tagged docs with anchor-id
headings → `verify-coverage.mjs` does the deterministic `manifest − docs` diff →
`gaps.md` → `uw-complete` fills them (loop to 100%) →
`uw-plan` → REBUILD-PLAN.md → `build-graph.mjs` → **rebuild-graph.json**
→ `uw-dashboard`. `detect-changes.mjs` (fingerprints) drives incremental refresh.

Artifacts live under the **target** repo's `docs/unwind/`:
`architecture.md`, `layers/**`, `REBUILD-PLAN.md`, `rebuild-graph.json`, and
`.cache/` (`scan-manifest.json`, `meta.json`, `changes.json`, `seeds/`, `coverage/`).

## Commands

```bash
pnpm install                                   # workspace deps (incl. tree-sitter grammars)
pnpm --filter @unwind/core build               # or: cd packages/core && tsc -p tsconfig.json
pnpm --filter @unwind/dashboard build          # vite production build
UNWIND_GRAPH_DIR=<project> pnpm --filter @unwind/dashboard dev   # dashboard on 127.0.0.1:5174

node skills/scripts/scan.mjs <projectRoot>            # → docs/unwind/.cache/scan-manifest.json (+ meta.json)
node skills/scripts/seed-layers.mjs <projectRoot>
node skills/scripts/verify-coverage.mjs <projectRoot>
node skills/scripts/build-graph.mjs <projectRoot>    # → docs/unwind/rebuild-graph.json
node skills/scripts/detect-changes.mjs <projectRoot> # incremental: diff vs meta.json baseline
```

## Deploy the drizzle-cube example

Recreates the live demo (https://unwind.cliftonc.nl) from a local `drizzle-cube`
checkout. Regenerates the **deterministic** artifacts from scratch and **reuses the
existing LLM layer docs** in `drizzle-cube/docs/unwind/layers/` — it does NOT re-run
the analysis specialists (run those separately if the docs are stale). `.deploy/` is
throwaway + gitignored, so the recipe recreates `wrangler.jsonc` inline.

```bash
DC=~/work/dc/drizzle-cube
pnpm --filter @unwind/core build                          # ensure dist/ current
node skills/scripts/scan.mjs "$DC"                        # fresh manifest (new ids + dataModelLinks)
node skills/scripts/seed-layers.mjs "$DC"
node skills/scripts/verify-coverage.mjs "$DC"             # coverage from the existing docs
node skills/scripts/build-graph.mjs "$DC"                 # → $DC/docs/unwind/rebuild-graph.json
pnpm --filter @unwind/dashboard build                     # → packages/dashboard/dist

rm -rf .deploy && mkdir -p .deploy/public
cp -R packages/dashboard/dist/. .deploy/public/           # app + nearform.svg (+ sample graph)
cp "$DC/docs/unwind/rebuild-graph.json" .deploy/public/   # overwrite sample with the real graph
cat > .deploy/wrangler.jsonc <<'JSON'
{
  "name": "unwind-dashboard",
  "compatibility_date": "2026-06-01",
  "assets": { "directory": "./public", "not_found_handling": "single-page-application" },
  "routes": [{ "pattern": "unwind.cliftonc.nl", "custom_domain": true }]
}
JSON
( cd .deploy && npx wrangler deploy )                     # needs Cloudflare auth (wrangler login)
```

The dashboard fetches `/rebuild-graph.json` and `/nearform.svg` at runtime; Vite
copies `public/nearform.svg` into `dist/` and bundles a small sample graph that the
`cp` above overwrites with drizzle-cube's.

## Conventions & gotchas

- **Scripts invoke the core** via `source skills/scripts/_resolve-plugin-root.sh;
  ensure_unwind_core; node "$UNWIND_PLUGIN_ROOT/skills/scripts/<x>.mjs"`. `.mjs`
  scripts resolve `@unwind/core` two ways (`require.resolve` → `dist/index.js`).
- **Candidate ids** are the join key across manifest, coverage, and graph:
  `function:path:name`, `class:…`, `table:…`, `endpoint:…`, `file:…` (see
  `manifest/candidates.ts` — the single source so seeds + coverage agree).
- **Anchor-id headings**: documented items use `### name [MUST] <!-- id: <id> -->`
  so `verify-coverage` matches by id (see `analysis-principles.md` #16/#17).
- **Symbol extraction** covers TS/JS, Python, Rust, Java, C# (tree-sitter WASM
  shipped by the grammar npm packages). SQL/Prisma tables + endpoints come from
  `contract-detectors.ts` (regex/queries). Other languages get file-grain coverage.
- **`tsc` cwd**: always `cd packages/core` (root `tsconfig.json` has no `include`).
- **Manifest schema is additive-only** — other code (coverage, graph) reads it; add
  optional fields, don't reshape `FileSymbols`.
- Skill markdown changes must keep the **graceful-fallback-to-legacy** path.

## Dashboard notes

- Theme tokens are CSS-var indirections (`--color-* → --c-*`) switched by
  `[data-theme]`; **dark is the default**, persisted to `localStorage`. Re-theming
  is mostly an `index.css` token swap.
- Filter/search/view state is serialized to the **URL** (`urlState.ts`) and
  hydrated on load. The graph fetch is guarded against React StrictMode's
  double-invoke (a second `setGraph` would clobber hydrated filters).
- `fitView` must run **after** React Flow measures custom nodes — a short settle
  delay (`GraphView.tsx`), not the same tick, or it centers on empty bounds.
- Live demo: https://unwind.cliftonc.nl (deployed via a throwaway `.deploy/` folder,
  Workers static-assets-only).
