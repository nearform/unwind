#!/usr/bin/env node
/**
 * verify-rebuild.mjs
 *
 * The before/after measurement. Scans the rebuilt TARGET repo into its own manifest,
 * joins it against the source rebuild-graph via the recorded source→target mapping
 * (held in rebuild-state.json), and writes:
 *   - docs/unwind/rebuild-verification-graph.json  (source↔target + completeness)
 *   - docs/unwind/rebuild-gaps.md                  ([MUST] items not yet equivalent)
 * It also writes the verification verdict back into rebuild-state.json (promoting
 * built nodes to `verified`, flagging `divergent`/`claimed`) and refreshes the
 * rebuild-progress.json overlay so the dashboard reflects reality.
 *
 * Usage:
 *   node verify-rebuild.mjs <sourceProjectRoot> [targetRoot]
 *   (targetRoot defaults to rebuild-state.json `targetRoot`.)
 *
 * Graceful degradation:
 *   - @unwind/core missing → exit 2 (caller falls back to pure-LLM, no measurement).
 *   - tree-sitter unavailable / weak target grammar → target scan degrades to
 *     file-grain; contract diffs become structural-presence only (still useful).
 * Exit 0 always when it runs (reporting tool); the orchestrator reads completenessPct.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const {
  buildManifest,
  TreeSitterPlugin,
  buildRebuildVerification,
  validateRebuildVerification,
  validateRebuildState,
  deriveProgressOverlay,
} = core;

const [, , sourceArg, targetArg] = process.argv;
if (!sourceArg) {
  process.stderr.write("Usage: node verify-rebuild.mjs <sourceProjectRoot> [targetRoot]\n");
  process.exit(1);
}
const sourceRoot = resolve(sourceArg);
const cacheDir = join(sourceRoot, "docs/unwind/.cache");
const manifestPath = join(cacheDir, "scan-manifest.json");
const graphPath = join(sourceRoot, "docs/unwind/rebuild-graph.json");
const statePath = join(cacheDir, "rebuild-state.json");

for (const [p, what] of [
  [manifestPath, "scan-manifest.json (run uw-scan)"],
  [graphPath, "rebuild-graph.json (run uw-graph/uw-dashboard)"],
  [statePath, "rebuild-state.json (run uw-build / merge-rebuild-map first)"],
]) {
  if (!existsSync(p)) {
    process.stderr.write(`verify-rebuild: missing ${what}: ${p}\n`);
    process.exit(1);
  }
}

const sourceManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const sourceGraph = JSON.parse(readFileSync(graphPath, "utf-8"));
const state = JSON.parse(readFileSync(statePath, "utf-8"));

const targetRoot = resolve(targetArg ?? state.targetRoot ?? "");
if (!targetArg && !state.targetRoot) {
  process.stderr.write("verify-rebuild: no targetRoot (pass one or set it in rebuild-state.json)\n");
  process.exit(1);
}
if (!existsSync(targetRoot)) {
  process.stderr.write(`verify-rebuild: target root does not exist: ${targetRoot}\n`);
  process.exit(1);
}

const now = new Date().toISOString();

// --- Scan the target repo (in-process; write to an ISOLATED dir so we never
// clobber the source's own .cache/meta.json baseline). ---
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
} catch (err) {
  process.stderr.write(
    `verify-rebuild: tree-sitter unavailable (${err.message}); target scan is file-grain\n`,
  );
}
const targetManifest = buildManifest({ projectRoot: targetRoot, generatedAt: now, extractSymbols });
const targetScanPath = join(cacheDir, "target-scan/scan-manifest.json");
mkdirSync(dirname(targetScanPath), { recursive: true });
writeFileSync(targetScanPath, JSON.stringify(targetManifest, null, 2), "utf-8");

// --- Mappings come from the state ledger (merge-rebuild-map ingested them). ---
const mappings = Object.entries(state.nodes ?? {})
  .filter(([, n]) => Array.isArray(n.targetIds) && n.targetIds.length > 0)
  .map(([sourceId, n]) => ({ sourceId, targetFiles: n.targetFiles ?? [], targetIds: n.targetIds }));

// --- Did the rebuild deliberately change API style? Then endpoint method+path
// diffs are meaningless — fall back to structural presence for endpoints. ---
const apiStyleChanged = detectApiStyleChange(sourceRoot);

// --- Build + validate + write the verification graph. ---
const vgraph = buildRebuildVerification(
  { sourceGraph, sourceManifest, targetManifest, mappings, apiStyleChanged },
  now,
);
const problems = validateRebuildVerification(vgraph);
if (problems.length > 0) {
  process.stderr.write(
    `verify-rebuild: verification graph failed validation:\n  - ${problems.join("\n  - ")}\n`,
  );
  process.exit(1);
}
const vgraphPath = join(sourceRoot, "docs/unwind/rebuild-verification-graph.json");
writeFileSync(vgraphPath, JSON.stringify(vgraph, null, 2), "utf-8");

// --- Write the verdict back into the state ledger + refresh the overlay. ---
for (const vn of vgraph.nodes) {
  const n = state.nodes?.[vn.sourceId];
  if (!n) continue; // out-of-scope source node with no state entry — leave untouched
  const isContract = vn.contractKind === "db-table" || vn.contractKind === "api-endpoint";
  switch (vn.rebuiltState) {
    case "equivalent":
      n.status = "verified";
      n.confirmedInTargetScan = true;
      n.contractEquivalence = "match";
      break;
    case "present":
      n.status = "done";
      n.confirmedInTargetScan = true;
      n.contractEquivalence = isContract ? "unchecked" : "n/a";
      break;
    case "divergent":
      n.status = "needs-recheck";
      n.confirmedInTargetScan = true;
      n.contractEquivalence = "mismatch";
      break;
    case "claimed":
      n.status = "in-progress";
      n.confirmedInTargetScan = false;
      break;
    // missing / excluded → leave the existing status as-is.
  }
}
state.updatedAt = now;
const stateProblems = validateRebuildState(state);
if (stateProblems.length > 0) {
  process.stderr.write(`verify-rebuild: WARNING state invalid after writeback:\n  - ${stateProblems.join("\n  - ")}\n`);
} else {
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  writeFileSync(join(cacheDir, "rebuild-progress.json"), JSON.stringify(deriveProgressOverlay(state), null, 2), "utf-8");
}

// --- Emit the gaps work list ([MUST] items not yet equivalent/present). ---
writeFileSync(join(sourceRoot, "docs/unwind/rebuild-gaps.md"), renderGaps(vgraph), "utf-8");

// --- Summary. ---
const s = vgraph.stats;
const byState = Object.entries(s.byRebuiltState).sort().map(([k, v]) => `${k}=${v}`).join(" ");
process.stderr.write(
  `verify-rebuild: completeness ${s.completenessPct}% (${s.mustEquivalentOrPresent}/${s.totalMust} MUST) ` +
    `${apiStyleChanged ? "[api-style-changed: endpoints structural-only] " : ""}\n` +
    `verify-rebuild: states ${byState}\n` +
    `verify-rebuild: wrote ${vgraphPath}\n`,
);

/**
 * Heuristic: did rebuild-decisions.json record a move OFF REST? If the chosen API
 * contract style isn't REST while the source exposes REST endpoints, an endpoint
 * method+path diff would be meaningless, so we disable it.
 */
function detectApiStyleChange(root) {
  const decisionsPath = join(root, "docs/unwind/.cache/rebuild-decisions.json");
  if (!existsSync(decisionsPath)) return false;
  try {
    const decisions = JSON.parse(readFileSync(decisionsPath, "utf-8"));
    for (const d of decisions.decisions ?? []) {
      if (/api.*style|contract style/i.test(d.topic ?? "")) {
        const chosen = String(d.chosen ?? "").toLowerCase();
        if (chosen && !chosen.includes("rest")) return true;
      }
    }
  } catch {
    /* malformed decisions — assume no change */
  }
  return false;
}

function renderGaps(vg) {
  const gaps = vg.nodes.filter(
    (n) => n.priority === "MUST" && ["missing", "claimed", "divergent"].includes(n.rebuiltState),
  );
  const lines = [
    "# Rebuild Gaps",
    "",
    `> Generated by verify-rebuild. Completeness: ${vg.stats.mustEquivalentOrPresent}/${vg.stats.totalMust} ` +
      `MUST (${vg.stats.completenessPct}%).`,
    "> These MUST-priority source items are not yet present-or-equivalent in the target.",
    "> `present` ≠ `correct`: structural presence does not prove behavior — use run-tests depth for that.",
    "",
  ];
  const groups = { missing: "Missing (no target mapping)", claimed: "Claimed but absent from target scan", divergent: "Divergent (built, contract mismatch)" };
  for (const [stateKey, title] of Object.entries(groups)) {
    const items = gaps.filter((n) => n.rebuiltState === stateKey);
    if (items.length === 0) continue;
    lines.push(`## ${title}`, "");
    for (const n of items) {
      lines.push(`### ${n.sourceId}`);
      lines.push(`- **Layer:** ${n.layer}`);
      if (n.contractKind) lines.push(`- **Contract:** ${n.contractKind}`);
      if (n.targetIds.length) lines.push(`- **Mapped to:** ${n.targetIds.join(", ")}`);
      if (n.diff?.missingFields?.length) lines.push(`- **Missing fields:** ${n.diff.missingFields.join(", ")}`);
      if (n.diff && n.diff.kind === "endpoint" && (n.diff.methodMatch === false || n.diff.pathMatch === false)) {
        lines.push(`- **Endpoint diff:** method ${n.diff.methodMatch ? "ok" : "MISMATCH"}, path ${n.diff.pathMatch ? "ok" : "MISMATCH"}`);
      }
      lines.push("");
    }
  }
  if (gaps.length === 0) lines.push("_No MUST-priority gaps — every required item is present or equivalent._", "");
  return lines.join("\n");
}
