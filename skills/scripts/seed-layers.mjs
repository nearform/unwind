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
const { candidatesByLayer, sourceLink, primaryDocDir, classifyTestKind } = core;

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

// Reconciled SQL DDL (db-ddl) is a physical contract of a canonical code-side
// table, not an independent checklist item. Map sqlId -> codeId so the seed can
// flag it `required: false` and point the specialist at its entity. Keeping it in
// the seed (rather than dropping it) tells the specialist the entity has DDL to
// attach; coverage already excludes db-ddl from the required count.
const contractOf = new Map();
for (const link of manifest.dataModelLinks ?? []) contractOf.set(link.sqlId, link.codeId);

const seedsDir = join(projectRoot, "docs/unwind/.cache/seeds");
mkdirSync(seedsDir, { recursive: true });

const toSeedItem = (c) => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  file: c.file,
  startLine: c.startLine,
  endLine: c.endLine,
  link: sourceLink(linkFormat, c.file, c.startLine, c.endLine),
  // db-ddl items are contracts attached to a code-side entity, not required docs.
  ...(c.kind === "db-ddl"
    ? { required: false, role: "contract", contractOf: contractOf.get(c.id) ?? null }
    : {}),
});

const summary = [];
// `name` is the seed filename, `docDir` the output folder. They match for tests
// (one seed per test specialist folder); for other layers the file keeps the
// layer name and `docDir` carries the (possibly renamed) folder, e.g.
// domain -> domain-model.
const writeSeed = (name, layer, docDir, candidates) => {
  const items = candidates.map(toSeedItem);
  writeFileSync(
    join(seedsDir, `${name}.json`),
    JSON.stringify({ layer, docDir, count: items.length, items }, null, 2),
    "utf-8",
  );
  summary.push(`${name}=${items.length}`);
};

for (const [layer, candidates] of Object.entries(byLayer)) {
  // The scanner emits a single `tests` layer; fan it out into one seed per test
  // specialist so each gets only its own checklist (unit/integration/e2e). The
  // seed filename IS the doc folder. Empty groups are skipped so we never
  // dispatch a specialist with nothing to do. Coverage still verifies the
  // unified `tests` layer by unioning all three folders.
  if (layer === "tests") {
    const groups = { "unit-tests": [], "integration-tests": [], "e2e-tests": [] };
    for (const c of candidates) groups[classifyTestKind(c.file)].push(c);
    for (const [docDir, group] of Object.entries(groups)) {
      if (group.length > 0) writeSeed(docDir, "tests", docDir, group);
    }
    continue;
  }
  writeSeed(layer, layer, primaryDocDir(layer), candidates);
}

process.stderr.write(`seed-layers: wrote ${summary.length} seed files to ${seedsDir}\n`);
process.stderr.write(`seed-layers: ${summary.sort().join(" ")}\n`);
