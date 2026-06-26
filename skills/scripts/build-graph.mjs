#!/usr/bin/env node
/**
 * build-graph.mjs
 *
 * Increment 4: emit docs/unwind/rebuild-graph.json — the joined knowledge-graph
 * artifact the @unwind/dashboard consumes. Fuses three deterministic inputs:
 *   - scan-manifest.json            (structure: files + symbols + imports)
 *   - .cache/coverage/{layer}.json  (what's documented; run verify-coverage.mjs)
 *   - docs/unwind/layers/**.md      (priority tags + doc refs)
 * plus an optional human-progress overlay:
 *   - .cache/rebuild-progress.json  (node id -> rebuildStatus; never clobbered)
 *
 * Usage:
 *   node build-graph.mjs <projectRoot> [manifestPath] [outputPath]
 *
 * Defaults:
 *   manifestPath = <projectRoot>/docs/unwind/.cache/scan-manifest.json
 *   outputPath   = <projectRoot>/docs/unwind/rebuild-graph.json
 *
 * Graceful: if @unwind/core or the manifest is missing, exits non-zero with a
 * clear message so the calling skill can fall back. Coverage and layer docs are
 * optional — without them the graph is still produced (everything "scanned").
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const {
  buildRebuildGraph,
  validateRebuildGraph,
  extractDocumentedItems,
  LAYER_DOC_DIRS,
} = core;

const [, , projectRootArg, manifestArg, outputArg] = process.argv;
if (!projectRootArg) {
  process.stderr.write(
    "Usage: node build-graph.mjs <projectRoot> [manifestPath] [outputPath]\n",
  );
  process.exit(1);
}

const projectRoot = resolve(projectRootArg);
if (!existsSync(projectRoot)) {
  process.stderr.write(`build-graph: projectRoot does not exist: ${projectRoot}\n`);
  process.exit(1);
}

const manifestPath = manifestArg
  ? resolve(manifestArg)
  : join(projectRoot, "docs/unwind/.cache/scan-manifest.json");
if (!existsSync(manifestPath)) {
  process.stderr.write(
    `build-graph: manifest not found: ${manifestPath}\nRun scan.mjs first.\n`,
  );
  process.exit(2);
}

const outputPath = outputArg
  ? resolve(outputArg)
  : join(projectRoot, "docs/unwind/rebuild-graph.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// --- Load coverage reports (optional; one JSON per layer). ---
const coverageDir = join(projectRoot, "docs/unwind/.cache/coverage");
const coverageByLayer = {};
if (existsSync(coverageDir)) {
  for (const ent of readdirSync(coverageDir)) {
    if (!ent.endsWith(".json")) continue;
    try {
      const cov = JSON.parse(readFileSync(join(coverageDir, ent), "utf-8"));
      if (cov && typeof cov.layer === "string") coverageByLayer[cov.layer] = cov;
    } catch {
      /* skip malformed coverage file */
    }
  }
}

// --- Parse documented items from every layer's markdown (priority + docRef). ---
function readMarkdown(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...readMarkdown(full));
    else if (ent.isFile() && ent.name.endsWith(".md") && ent.name !== "gaps.md") {
      out.push({ path: full, content: readFileSync(full, "utf-8") });
    }
  }
  return out;
}

const layersRoot = join(projectRoot, "docs/unwind/layers");
const documented = [];
// Iterate every known layer doc dir plus any extra dirs present on disk.
const docDirs = new Set(Object.values(LAYER_DOC_DIRS).flat());
if (existsSync(layersRoot)) {
  for (const ent of readdirSync(layersRoot, { withFileTypes: true })) {
    if (ent.isDirectory()) docDirs.add(ent.name);
  }
}
for (const dir of docDirs) {
  const full = join(layersRoot, dir);
  for (const f of readMarkdown(full)) {
    documented.push(
      ...extractDocumentedItems(f.content, f.path.replace(projectRoot + "/", "")),
    );
  }
}

// --- Optional human-progress overlay. ---
let progress;
const progressPath = join(projectRoot, "docs/unwind/.cache/rebuild-progress.json");
if (existsSync(progressPath)) {
  try {
    progress = JSON.parse(readFileSync(progressPath, "utf-8"));
  } catch {
    process.stderr.write(
      `build-graph: ignoring malformed rebuild-progress.json\n`,
    );
  }
}

// --- Optional rebuild target mapping (the "build assets", from uw-build). ---
// rebuild-state.json carries per-node target files/ids; the verification graph
// carries the per-node rebuilt verdict + headline completeness stats. Both are
// optional — without them the graph is the source-only planning view.
let rebuildState;
const rebuildStatePath = join(projectRoot, "docs/unwind/.cache/rebuild-state.json");
if (existsSync(rebuildStatePath)) {
  try {
    rebuildState = JSON.parse(readFileSync(rebuildStatePath, "utf-8"));
  } catch {
    process.stderr.write("build-graph: ignoring malformed rebuild-state.json\n");
  }
}

let verification;
const verificationPath = join(projectRoot, "docs/unwind/rebuild-verification-graph.json");
if (existsSync(verificationPath)) {
  try {
    verification = JSON.parse(readFileSync(verificationPath, "utf-8"));
  } catch {
    process.stderr.write("build-graph: ignoring malformed rebuild-verification-graph.json\n");
  }
}

// --- Optional incremental staleness (from detect-changes.mjs). ---
let staleIds;
const changesPath = join(projectRoot, "docs/unwind/.cache/changes.json");
if (existsSync(changesPath)) {
  try {
    const changes = JSON.parse(readFileSync(changesPath, "utf-8"));
    if (Array.isArray(changes.staleItems) && changes.staleItems.length > 0) {
      staleIds = changes.staleItems;
      process.stderr.write(`build-graph: applying ${staleIds.length} stale ids from changes.json\n`);
    }
  } catch {
    process.stderr.write("build-graph: ignoring malformed changes.json\n");
  }
}

// --- Build, validate, write. ---
const graph = buildRebuildGraph(
  { manifest, coverageByLayer, documented, progress, staleIds, rebuildState, verification },
  new Date().toISOString(),
);

const problems = validateRebuildGraph(graph);
if (problems.length > 0) {
  process.stderr.write(
    `build-graph: rebuild graph failed validation:\n  - ${problems.join("\n  - ")}\n`,
  );
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(graph, null, 2), "utf-8");
if (!existsSync(outputPath)) {
  throw new Error(`output file missing after write: ${outputPath}`);
}

// --- Also emit docs-bundle.json: every markdown doc under docs/unwind, bundled
// so the dashboard's Docs view works in both dev (vite serves it) and the
// static-assets-only production deploy (the file is copied alongside the graph).
// The graph itself does NOT enumerate doc files (root files like architecture.md
// / REBUILD-PLAN.md are referenced by no node), so we walk the tree directly. ---
const docsRoot = join(projectRoot, "docs/unwind");

/** Recursively collect *.md files under docs/unwind, skipping .cache. */
function collectDocFiles(dir, relPrefix = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue; // skip .cache and dotfiles
    const full = join(dir, ent.name);
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...collectDocFiles(full, rel));
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push({ rel, full });
  }
  return out;
}

/** Title from the first markdown H1, else a prettified filename. */
function docTitle(content, rel) {
  const m = content.match(/^#\s+(.+?)\s*$/m);
  if (m) return m[1].trim();
  const base = rel.split("/").pop().replace(/\.md$/, "");
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const docFiles = collectDocFiles(docsRoot)
  .map(({ rel, full }) => {
    const content = readFileSync(full, "utf-8");
    // Group: top-level files under "Overview"; layer docs under their folder.
    const group = rel.startsWith("layers/") ? rel.split("/")[1] : "Overview";
    return { path: rel, title: docTitle(content, rel), group, content };
  })
  // Stable order: Overview docs first, then layer docs alphabetically by path.
  .sort((a, b) => {
    const ao = a.group === "Overview" ? 0 : 1;
    const bo = b.group === "Overview" ? 0 : 1;
    return ao - bo || a.path.localeCompare(b.path);
  });

const docsBundle = {
  version: "1",
  generatedAt: graph.generatedAt,
  root: "docs/unwind",
  files: docFiles,
};
const docsBundlePath = join(docsRoot, "docs-bundle.json");
writeFileSync(docsBundlePath, JSON.stringify(docsBundle, null, 2), "utf-8");
process.stderr.write(`build-graph: wrote ${docsBundlePath} (${docFiles.length} docs)\n`);

// --- Summary. ---
const s = graph.stats;
const layerSummary = graph.layers
  .map((l) => `${l.id}=${l.nodeCount}`)
  .join(" ");
const covSummary = Object.entries(s.byCoverage)
  .sort()
  .map(([k, v]) => `${k}=${v}`)
  .join(" ");
process.stderr.write(
  `build-graph: nodes=${s.nodeCount} edges=${s.edgeCount} layers=${s.layerCount} ` +
    `coverage=${s.coveragePct}%\n` +
    `build-graph: layers ${layerSummary}\n` +
    `build-graph: coverage ${covSummary}\n` +
    `build-graph: edges ${Object.entries(s.byEdgeType).map(([k, v]) => `${k}=${v}`).join(" ")}\n` +
    `build-graph: wrote ${outputPath}\n`,
);
if (graph.rebuildVerification) {
  const rv = graph.rebuildVerification;
  const mapped = graph.nodes.filter((n) => n.rebuild.target && n.rebuild.target.files.length > 0).length;
  process.stderr.write(
    `build-graph: rebuild completeness=${rv.completenessPct}% ` +
      `(${rv.mustEquivalentOrPresent}/${rv.totalMust} MUST) ` +
      `target=${rv.targetProject?.name ?? "?"} mappedNodes=${mapped}\n`,
  );
}
