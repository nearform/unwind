#!/usr/bin/env node
/**
 * merge-rebuild-map.mjs
 *
 * Ingest the per-slice source→target mapping files the builder agents wrote
 * (docs/unwind/.cache/rebuild-map/*.json) into the orchestrator's durable ledger
 * (docs/unwind/.cache/rebuild-state.json), then derive the rebuild-progress.json
 * overlay the existing dashboard already consumes.
 *
 * Builders only ever write their OWN slice map file (write-only, isolated → no
 * races); this script is the single deterministic writer of rebuild-state.json, so
 * the orchestrator LLM never hand-edits state JSON.
 *
 * It also reconciles incremental staleness: any node whose source changed
 * structurally (changes.json `staleItems`) and was already done/verified is flipped
 * to `needs-recheck` — mirroring build-graph.ts so the two state machines agree.
 *
 * Usage:
 *   node merge-rebuild-map.mjs <projectRoot>
 *
 * Graceful: exits 2 if @unwind/core is unavailable (the caller falls back to the
 * pure-LLM flow, where the orchestrator records state without this convenience).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCore } from "./_core.mjs";

const core = await loadCore();
const { validateRebuildState, deriveProgressOverlay, REBUILD_STATE_VERSION } = core;

const [, , projectRootArg] = process.argv;
if (!projectRootArg) {
  process.stderr.write("Usage: node merge-rebuild-map.mjs <projectRoot>\n");
  process.exit(1);
}
const projectRoot = resolve(projectRootArg);
const cacheDir = join(projectRoot, "docs/unwind/.cache");
const statePath = join(cacheDir, "rebuild-state.json");
const mapDir = join(cacheDir, "rebuild-map");
const changesPath = join(cacheDir, "changes.json");
const progressPath = join(cacheDir, "rebuild-progress.json");

const now = new Date().toISOString();

// --- Load (or bootstrap) the state ledger. -------------------------------
let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf-8"));
} else {
  // Minimal valid skeleton so the script is robust when run before the orchestrator
  // has written a full config (the orchestrator normally seeds scope/order/slices).
  state = {
    version: REBUILD_STATE_VERSION,
    generatedAt: now,
    updatedAt: now,
    targetRoot: "",
    config: {
      scope: "whole",
      verificationDepth: "contract-diff",
      executionMode: "step-through",
      sliceOrder: [],
      scaffolded: false,
    },
    nodes: {},
    slices: {},
  };
}
state.nodes ??= {};
state.slices ??= {};

// --- Merge every per-slice map file. -------------------------------------
let mapFiles = [];
if (existsSync(mapDir)) {
  mapFiles = readdirSync(mapDir).filter((f) => f.endsWith(".json"));
}
let merged = 0;
for (const f of mapFiles) {
  let map;
  try {
    map = JSON.parse(readFileSync(join(mapDir, f), "utf-8"));
  } catch {
    process.stderr.write(`merge-rebuild-map: skipping malformed ${f}\n`);
    continue;
  }
  if (map.targetRoot && !state.targetRoot) state.targetRoot = map.targetRoot;
  for (const m of map.mappings ?? []) {
    if (!m || typeof m.sourceId !== "string") continue;
    const prev = state.nodes[m.sourceId] ?? {};
    state.nodes[m.sourceId] = {
      ...prev,
      // The agent built it this round → "done" (verify-rebuild may promote to
      // "verified" or flag it). A previously-verified node stays verified unless a
      // re-map changed it; re-mapping implies a rebuild, so reset to "done".
      status: "done",
      targetFiles: Array.isArray(m.targetFiles) ? m.targetFiles : [],
      targetIds: Array.isArray(m.targetIds) ? m.targetIds : [],
    };
    merged++;
  }
  // Record the slice as built (verify-rebuild upgrades to "verified").
  if (typeof map.sliceId === "string") {
    const slice = state.slices[map.sliceId] ?? { id: map.sliceId, status: "in-progress", nodeIds: [] };
    const ids = (map.mappings ?? []).map((m) => m.sourceId).filter(Boolean);
    slice.nodeIds = Array.from(new Set([...(slice.nodeIds ?? []), ...ids]));
    slice.status = "built";
    slice.builtAt = now;
    state.slices[map.sliceId] = slice;
  }
}

// --- Reconcile incremental staleness (mirror build-graph.ts). ------------
let staleApplied = 0;
if (existsSync(changesPath)) {
  try {
    const changes = JSON.parse(readFileSync(changesPath, "utf-8"));
    for (const id of changes.staleItems ?? []) {
      const n = state.nodes[id];
      if (n && (n.status === "done" || n.status === "verified")) {
        n.status = "needs-recheck";
        staleApplied++;
      }
    }
  } catch {
    process.stderr.write("merge-rebuild-map: ignoring malformed changes.json\n");
  }
}

state.updatedAt = now;

// --- Validate, then write state + the derived progress overlay. ----------
const problems = validateRebuildState(state);
if (problems.length > 0) {
  process.stderr.write(
    `merge-rebuild-map: rebuild-state.json failed validation:\n  - ${problems.join("\n  - ")}\n`,
  );
  process.exit(1);
}

mkdirSync(cacheDir, { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

const overlay = deriveProgressOverlay(state);
writeFileSync(progressPath, JSON.stringify(overlay, null, 2), "utf-8");

process.stderr.write(
  `merge-rebuild-map: merged ${merged} mappings from ${mapFiles.length} slice file(s); ` +
    `${staleApplied} stale -> needs-recheck\n` +
    `merge-rebuild-map: wrote ${statePath} and ${progressPath} (${Object.keys(overlay).length} overlay entries)\n`,
);
