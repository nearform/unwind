#!/usr/bin/env node
/**
 * detect-changes.mjs
 *
 * Incremental change detection. Compares a fresh scan against the baseline
 * `meta.json` fingerprints (written by scan.mjs) and reports what moved, which
 * layers are affected, and which previously-documented items are now stale.
 *
 * The orchestrator uses this to re-analyze ONLY the affected layers during a
 * refresh, instead of re-unwinding the whole codebase — keeping the docs/graph
 * fresh across a long migration.
 *
 * Usage:
 *   node detect-changes.mjs <projectRoot> [manifestDir]
 *
 * Reads:  <projectRoot>/docs/unwind/.cache/meta.json   (baseline)
 *         <projectRoot>/docs/unwind/.cache/coverage/*.json (to find documented items)
 * Writes: <projectRoot>/docs/unwind/.cache/changes.json
 *
 * Does NOT overwrite meta.json — the baseline only refreshes when scan.mjs runs.
 * Exit 0 always (reporting tool). Exit 3 if no baseline exists (run scan first).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const { buildManifest, buildFingerprints, classifyChanges, TreeSitterPlugin, fileCandidates } = core;

const [, , projectRootArg, manifestDirArg] = process.argv;
if (!projectRootArg) {
  process.stderr.write("Usage: node detect-changes.mjs <projectRoot> [cacheDir]\n");
  process.exit(1);
}
const projectRoot = resolve(projectRootArg);
const cacheDir = manifestDirArg
  ? resolve(manifestDirArg)
  : join(projectRoot, "docs/unwind/.cache");
const metaPath = join(cacheDir, "meta.json");

if (!existsSync(metaPath)) {
  process.stderr.write(
    `detect-changes: no baseline at ${metaPath}. Run scan.mjs first to establish one.\n`,
  );
  process.exit(3);
}

const baseline = JSON.parse(readFileSync(metaPath, "utf-8"));

// Fresh scan in-memory (does NOT write the manifest or clobber the baseline).
let extractSymbols;
try {
  const plugin = new TreeSitterPlugin();
  await plugin.init();
  extractSymbols = (file, content) => {
    try {
      return plugin.analyze(file.path, content);
    } catch {
      return null;
    }
  };
} catch {
  /* file-grain fallback */
}
const current = buildManifest({
  projectRoot,
  generatedAt: new Date().toISOString(),
  extractSymbols,
});
const currentFp = buildFingerprints(current);

const changes = classifyChanges(baseline.fingerprints ?? {}, currentFp);

// Map changed files -> layer + their candidate ids (from the fresh manifest).
const fileByPath = new Map(current.files.map((f) => [f.path, f]));
const affectedLayers = new Set();
for (const p of [...changes.added, ...changes.structural]) {
  const f = fileByPath.get(p);
  if (f) affectedLayers.add(f.rebuildLayer);
}

// Documented items: covered = (candidate ids) MINUS (coverage `missing` ids).
// Load the coverage cache to know what was documented before this change.
const missingIds = new Set();
let coverageSeen = false;
const coverageDir = join(cacheDir, "coverage");
try {
  for (const ent of readdirSync(coverageDir)) {
    if (!ent.endsWith(".json")) continue;
    coverageSeen = true;
    const cov = JSON.parse(readFileSync(join(coverageDir, ent), "utf-8"));
    for (const m of cov.missing ?? []) missingIds.add(m.id);
  }
} catch {
  /* no coverage cache yet */
}

// Stale items: candidate ids in structurally-changed files that WERE documented
// (i.e. not in the missing set). Only meaningful once coverage has been run.
const staleItems = [];
const newItems = [];
for (const p of changes.structural) {
  const f = fileByPath.get(p);
  if (!f) continue;
  for (const c of fileCandidates(f)) {
    if (coverageSeen && !missingIds.has(c.id)) staleItems.push(c.id);
  }
}
for (const p of changes.added) {
  const f = fileByPath.get(p);
  if (!f) continue;
  for (const c of fileCandidates(f)) newItems.push(c.id);
}

const out = {
  generatedAt: new Date().toISOString(),
  commitFrom: baseline.gitCommitHash ?? null,
  commitTo: current.gitCommitHash ?? null,
  counts: {
    added: changes.added.length,
    removed: changes.removed.length,
    structural: changes.structural.length,
    cosmetic: changes.cosmetic.length,
    unchanged: changes.unchanged.length,
  },
  added: changes.added,
  removed: changes.removed,
  structural: changes.structural,
  cosmetic: changes.cosmetic,
  affectedLayers: [...affectedLayers].sort(),
  staleItems,
  newItems,
};

mkdirSync(cacheDir, { recursive: true });
const outPath = join(cacheDir, "changes.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

const c = out.counts;
process.stderr.write(
  `detect-changes: added=${c.added} removed=${c.removed} structural=${c.structural} ` +
    `cosmetic=${c.cosmetic} unchanged=${c.unchanged}\n`,
);
process.stderr.write(
  `detect-changes: affectedLayers=${out.affectedLayers.join(",") || "(none)"} ` +
    `stale=${staleItems.length} new=${newItems.length}\n`,
);
process.stderr.write(`detect-changes: wrote ${outPath}\n`);
if (c.added === 0 && c.removed === 0 && c.structural === 0) {
  process.stderr.write("detect-changes: no structural changes — docs/graph remain valid.\n");
}
