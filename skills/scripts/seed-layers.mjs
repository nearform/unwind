#!/usr/bin/env node
/**
 * seed-layers.mjs
 *
 * Emit per-layer candidate lists from scan-manifest.json. Each layer specialist
 * is dispatched WITH its seed file pasted in: "here are the N items the scanner
 * found — document every one; to omit one, mark it excluded with a reason."
 * This turns completeness from an exhortation into an explicit checklist.
 *
 * Usage:
 *   node seed-layers.mjs <projectRoot> [manifestPath]
 *
 * Output: <projectRoot>/docs/unwind/.cache/seeds/{layer}.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const { candidatesByLayer, sourceLink } = core;

const [, , projectRootArg, manifestArg] = process.argv;
if (!projectRootArg) {
  process.stderr.write("Usage: node seed-layers.mjs <projectRoot> [manifestPath]\n");
  process.exit(1);
}
const projectRoot = resolve(projectRootArg);
const manifestPath = manifestArg
  ? resolve(manifestArg)
  : join(projectRoot, "docs/unwind/.cache/scan-manifest.json");

if (!existsSync(manifestPath)) {
  process.stderr.write(`seed-layers: manifest not found: ${manifestPath}\nRun scan.mjs first.\n`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const linkFormat = manifest.repository?.linkFormat ?? "{path}:{start}-{end}";
const byLayer = candidatesByLayer(manifest);

const seedsDir = join(projectRoot, "docs/unwind/.cache/seeds");
mkdirSync(seedsDir, { recursive: true });

const summary = [];
for (const [layer, candidates] of Object.entries(byLayer)) {
  const seeds = candidates.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    file: c.file,
    startLine: c.startLine,
    endLine: c.endLine,
    link: sourceLink(linkFormat, c.file, c.startLine, c.endLine),
  }));
  const outPath = join(seedsDir, `${layer}.json`);
  writeFileSync(outPath, JSON.stringify({ layer, count: seeds.length, items: seeds }, null, 2), "utf-8");
  summary.push(`${layer}=${seeds.length}`);
}

process.stderr.write(`seed-layers: wrote ${Object.keys(byLayer).length} seed files to ${seedsDir}\n`);
process.stderr.write(`seed-layers: ${summary.sort().join(" ")}\n`);
