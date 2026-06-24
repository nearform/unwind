#!/usr/bin/env node
/**
 * plan-brief.mjs
 *
 * Emits docs/unwind/.cache/plan-brief.json — the deterministic "rebuild brief"
 * that grounds the uw-plan interview. The plan step asks the user the strategic
 * questions only they can answer (target stack, what to keep vs rebuild, phasing,
 * risk); this script supplies the verifiable facts that frame each question with a
 * data-grounded default, so the LLM never re-derives counts from prose.
 *
 * Fuses three deterministic inputs (manifest is the only hard dependency):
 *   - scan-manifest.json            (project, files+symbols, importMap, contracts)
 *   - .cache/coverage/{layer}.json  (readiness per layer; run verify-coverage.mjs)
 *   - docs/unwind/layers/**.md      ([MUST]/[SHOULD]/[DON'T] tallies per layer)
 *
 * Usage:
 *   node plan-brief.mjs <projectRoot> [manifestPath] [outputPath]
 *
 * Defaults:
 *   manifestPath = <projectRoot>/docs/unwind/.cache/scan-manifest.json
 *   outputPath   = <projectRoot>/docs/unwind/.cache/plan-brief.json
 *
 * Graceful: if @unwind/core or the manifest is missing, exits non-zero with a
 * clear message so the calling skill can fall back to reading the artifacts
 * directly (or the legacy pure-LLM flow). Coverage and layer docs are optional —
 * without them coverage is null and priority tallies are zero, but the brief still
 * emits from the manifest alone.
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
const { candidatesByLayer, extractDocumentedItems, docDirsForLayer } = core;

const [, , projectRootArg, manifestArg, outputArg] = process.argv;
if (!projectRootArg) {
  process.stderr.write(
    "Usage: node plan-brief.mjs <projectRoot> [manifestPath] [outputPath]\n",
  );
  process.exit(1);
}

const projectRoot = resolve(projectRootArg);
if (!existsSync(projectRoot)) {
  process.stderr.write(`plan-brief: projectRoot does not exist: ${projectRoot}\n`);
  process.exit(1);
}

const manifestPath = manifestArg
  ? resolve(manifestArg)
  : join(projectRoot, "docs/unwind/.cache/scan-manifest.json");
if (!existsSync(manifestPath)) {
  process.stderr.write(
    `plan-brief: manifest not found: ${manifestPath}\nRun scan.mjs first.\n`,
  );
  process.exit(2);
}

const outputPath = outputArg
  ? resolve(outputArg)
  : join(projectRoot, "docs/unwind/.cache/plan-brief.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];

// --- Coverage reports (optional; one JSON per layer, keyed by `layer`). ---
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

// --- Documented-item priority tallies per layer (optional; needs layer docs). ---
const layersRoot = join(projectRoot, "docs/unwind/layers");

/** Read all markdown under a directory (recursive), excluding gaps.md. */
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

/** {MUST,SHOULD,DON'T} counts from the documented items in a layer's doc dirs. */
function priorityTally(layer) {
  const tally = { must: 0, should: 0, dont: 0, untagged: 0 };
  const dirNames =
    typeof docDirsForLayer === "function" ? docDirsForLayer(layer) : [layer];
  for (const d of dirNames) {
    const dir = join(layersRoot, d);
    if (!existsSync(dir)) continue;
    for (const f of readMarkdown(dir)) {
      for (const item of extractDocumentedItems(
        f.content,
        f.path.replace(projectRoot + "/", ""),
      )) {
        if (item.tag === "MUST") tally.must++;
        else if (item.tag === "SHOULD") tally.should++;
        else if (item.tag === "DON'T") tally.dont++;
        else tally.untagged++;
      }
    }
  }
  return tally;
}

// --- Per-layer facts: candidates, files, symbols, coverage, priorities. ---
const byLayer = candidatesByLayer(manifest); // { layer: Candidate[] }
const layerFromStats = (manifest.stats && manifest.stats.byLayer) || {};

function symbolCount(layerFiles) {
  let n = 0;
  for (const f of layerFiles) {
    const s = f.symbols || {};
    n +=
      (s.functions?.length || 0) +
      (s.classes?.length || 0) +
      (s.definitions?.length || 0) +
      (s.endpoints?.length || 0);
  }
  return n;
}

const layerSet = new Set([
  ...Object.keys(byLayer),
  ...Object.keys(layerFromStats),
]);

const perLayer = [];
for (const layer of layerSet) {
  const layerFiles = files.filter((f) => f.rebuildLayer === layer);
  const cov = coverageByLayer[layer];
  perLayer.push({
    layer,
    fileCount: layerFiles.length || layerFromStats[layer] || 0,
    candidateCount: (byLayer[layer] || []).length,
    symbolCount: symbolCount(layerFiles),
    coverage: cov
      ? {
          covered: cov.covered,
          total: cov.total,
          coveragePct: cov.coveragePct,
          missingCount: Array.isArray(cov.missing) ? cov.missing.length : 0,
        }
      : null,
    priorities: priorityTally(layer),
  });
}
// Largest layers first — the plan reads top-down for effort weighting.
perLayer.sort((a, b) => b.candidateCount - a.candidateCount || b.fileCount - a.fileCount);

// --- Contract inventory: data models, SQL DDL, endpoints, ORM<->SQL links. ---
const byDefinitionKind = {};
const byEndpointMethod = {};
const ormSources = {}; // detector/framework name -> count (drizzle, prisma, jpa, ...)
let endpoints = 0;
let dataModels = 0;
let sqlDdl = 0;
for (const f of files) {
  const s = f.symbols || {};
  for (const d of s.definitions || []) {
    byDefinitionKind[d.kind] = (byDefinitionKind[d.kind] || 0) + 1;
    if (d.kind === "db-ddl") sqlDdl++;
    else dataModels++;
    if (d.source) ormSources[d.source] = (ormSources[d.source] || 0) + 1;
  }
  for (const e of s.endpoints || []) {
    endpoints++;
    const m = (e.method || "?").toUpperCase();
    byEndpointMethod[m] = (byEndpointMethod[m] || 0) + 1;
  }
}
const contracts = {
  dataModels, // canonical code-side definitions (tables/entities/types)
  sqlDdl, // physical DDL contracts (reconciled onto code models)
  dataModelLinks: Array.isArray(manifest.dataModelLinks)
    ? manifest.dataModelLinks.length
    : 0,
  endpoints,
  byDefinitionKind,
  byEndpointMethod,
};

// --- Detected source stack: what the CURRENT system is built with, so the
// interview can recommend concrete targets ("on Drizzle today -> keep, or move
// to X?"). Languages come from the manifest; ORM/DB frameworks from definition
// `source` tags. Dependency manifests (package.json etc.) are read by the skill
// itself for the fuller library list. ---
const detected = {
  languages: manifest.project?.languages ?? [],
  ormSources, // e.g. { drizzle: 39 } — the data-access framework in use
  hasEndpoints: endpoints > 0,
  endpointMethods: Object.keys(byEndpointMethod),
};

// --- Import graph: foundations (no internal deps) + hubs (most depended-upon). ---
const importMap =
  manifest.importMap && typeof manifest.importMap === "object"
    ? manifest.importMap
    : {};
const indegree = new Map();
for (const targets of Object.values(importMap)) {
  for (const t of targets || []) indegree.set(t, (indegree.get(t) || 0) + 1);
}
const hubs = [...indegree.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([file, dependents]) => ({ file, dependents }));
// Rebuild foundations are depended-upon leaves: files something imports but which
// import nothing internal themselves (schema, utils, constants). `importMap` only
// keys files that HAVE internal imports, so a target absent from its keys (or
// keyed with an empty array) has no outgoing edges — build these first.
const foundations = [...indegree.keys()]
  .filter((t) => !importMap[t] || importMap[t].length === 0)
  .sort((a, b) => indegree.get(b) - indegree.get(a));
const importGraph = {
  fileCount: Object.keys(importMap).length,
  hubs,
  foundationCount: foundations.length,
  foundations: foundations.slice(0, 15).map((file) => ({
    file,
    dependents: indegree.get(file) || 0,
  })),
};

// --- Readiness: overall coverage + layers below 100%. ---
let coveredSum = 0;
let totalSum = 0;
for (const cov of Object.values(coverageByLayer)) {
  coveredSum += cov.covered || 0;
  totalSum += cov.total || 0;
}
const provisionalLayers = Object.values(coverageByLayer)
  .filter((c) => c.total > 0 && c.coveragePct < 100)
  .map((c) => ({ layer: c.layer, coveragePct: c.coveragePct }))
  .sort((a, b) => a.coveragePct - b.coveragePct);
const readiness = {
  hasCoverage: Object.keys(coverageByLayer).length > 0,
  overallCoveragePct:
    totalSum === 0 ? null : Math.round((coveredSum / totalSum) * 1000) / 10,
  provisionalLayers, // layers < 100% — plan should flag itself provisional here
};

const brief = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  project: {
    name: manifest.project?.name ?? "unknown",
    languages: manifest.project?.languages ?? [],
    estimatedComplexity: manifest.project?.estimatedComplexity ?? "unknown",
    totalFiles: manifest.stats?.totalFiles ?? files.length,
    byLanguage: manifest.stats?.byLanguage ?? {},
  },
  detected,
  perLayer,
  contracts,
  importGraph,
  readiness,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(brief, null, 2), "utf-8");

// --- Summary to stderr. ---
process.stderr.write(
  `plan-brief: ${brief.project.name} (${brief.project.estimatedComplexity}, ` +
    `${brief.project.totalFiles} files, ${brief.project.languages.join("/")})\n` +
    `plan-brief: contracts dataModels=${contracts.dataModels} endpoints=${contracts.endpoints} ` +
    `sqlDdl=${contracts.sqlDdl} links=${contracts.dataModelLinks}\n` +
    `plan-brief: overall coverage=${readiness.overallCoveragePct ?? "n/a"}% ` +
    `provisional=${provisionalLayers.length} foundations=${importGraph.foundationCount}\n`,
);
for (const l of perLayer) {
  const cov = l.coverage ? `${l.coverage.coveragePct}%` : "n/a";
  process.stderr.write(
    `  ${l.layer.padEnd(15)} files=${String(l.fileCount).padStart(3)} ` +
      `cand=${String(l.candidateCount).padStart(4)} cov=${cov.padStart(6)} ` +
      `[MUST]=${l.priorities.must} [SHOULD]=${l.priorities.should} [DON'T]=${l.priorities.dont}\n`,
  );
}
process.stderr.write(`plan-brief: wrote ${outputPath}\n`);
