/**
 * rebuild-state.json — the orchestrator's durable session ledger for `uw-build`.
 *
 * Where rebuild-graph.json is a refreshable projection the dashboard reads, this
 * file is the rebuild EXECUTOR's source of truth: what slices exist, in what
 * order, which source candidates have been (re)built and where they landed in the
 * target repo (the source→target mapping), and — for loop mode — the persisted
 * convergence counters that guarantee a self-paced `/loop` terminates.
 *
 * It is keyed by the SAME stable candidate ids minted by candidates.ts
 * (`function:path:name`, `class:...`, `table:...`, `endpoint:...`, `file:...`), so
 * it joins 1:1 with rebuild-graph nodes and the rebuild-progress.json overlay the
 * dashboard already consumes. `merge-rebuild-map.mjs` owns writes (read-modify-write,
 * never clobbering other slices); the orchestrator LLM never hand-edits it.
 *
 * `RebuildStatus` is imported from rebuild-graph-schema.ts — NOT redeclared — because
 * the progress overlay contract (node id -> RebuildStatus) is shared with the graph.
 *
 * Validation is hand-rolled (zero runtime deps), matching manifest-schema.ts and
 * rebuild-graph-schema.ts.
 */

import type { ContractKind, RebuildPriority, RebuildStatus } from "./rebuild-graph-schema.js";

export const REBUILD_STATE_VERSION = "1.0.0";

/** How much of the rebuild this run covers (set in the uw-build interview). */
export type RebuildScope = "one-slice" | "one-phase" | "whole";

/** How deep verification goes before a node can be considered done/verified. */
export type VerificationDepth = "structural" | "contract-diff" | "run-tests";

/** Step through with a gate per slice, or loop until the verification target is met. */
export type ExecutionMode = "step-through" | "loop";

/**
 * Deterministic contract-equivalence outcome for a node, set by verify-rebuild and
 * mirrored here for resume. `n/a` = non-contract node (nothing to diff);
 * `unchecked` = a contract node we could not diff (e.g. weak target grammar, or the
 * API style changed so an endpoint diff would be meaningless).
 */
export type ContractEquivalence = "match" | "mismatch" | "n/a" | "unchecked";

/** Per source-candidate build/verify progress. Keyed by source candidate id. */
export interface RebuildNodeState {
  /** Reuses the shared overlay enum: not-started|in-progress|done|verified|needs-recheck. */
  status: RebuildStatus;
  /** Target files the builder reported writing for this node (target-relative). */
  targetFiles: string[];
  /** Target candidate ids (kind:path:name in the TARGET manifest) this maps to. */
  targetIds: string[];
  notes?: string;
  /** Set by verify-rebuild: did the target scan actually contain the targetIds? */
  confirmedInTargetScan?: boolean;
  /** Set by verify-rebuild: contract-equivalence result for contract nodes. */
  contractEquivalence?: ContractEquivalence;
}

/** A unit of work in the build loop (a layer key, or a phase id grouping layers). */
export interface SliceState {
  id: string;
  status: "not-started" | "in-progress" | "built" | "verified";
  builtAt?: string;
  /** Source candidate ids that belong to this slice. */
  nodeIds: string[];
}

/**
 * Loop-mode convergence state. Persisted so a fresh `/loop` iteration that starts
 * cold (after context compaction) can still decide whether to continue or STOP —
 * the dry-round counter is what guarantees a self-paced loop can't spin forever.
 */
export interface LoopState {
  enabled: boolean;
  /** Completeness percentage (over in-scope [MUST]) that ends the loop. */
  targetPct: number;
  /** Consecutive iterations with no increase in mustEquivalentOrPresent. */
  dryRounds: number;
  /** Completeness measured at the end of the last iteration. */
  lastCompletenessPct: number;
  /** The slice processed in the last iteration (null before the first). */
  lastSliceId: string | null;
}

export interface RebuildStateConfig {
  scope: RebuildScope;
  verificationDepth: VerificationDepth;
  executionMode: ExecutionMode;
  /** Ordered slice ids — the build/loop processing order (seeded from phasing). */
  sliceOrder: string[];
  /** Whether the target project skeleton has been scaffolded yet. */
  scaffolded: boolean;
}

export interface RebuildState {
  version: string;
  generatedAt: string;
  updatedAt: string;
  /** Where the rebuilt code lives (absolute, or relative to the source repo). */
  targetRoot: string;
  config: RebuildStateConfig;
  /** Present only in loop execution mode. */
  loopState?: LoopState;
  /** Per source-candidate progress, keyed by source candidate id. */
  nodes: Record<string, RebuildNodeState>;
  /** Slice-level rollup for the build loop + resume. */
  slices: Record<string, SliceState>;
}

const SCOPES = new Set<RebuildScope>(["one-slice", "one-phase", "whole"]);
const DEPTHS = new Set<VerificationDepth>(["structural", "contract-diff", "run-tests"]);
const MODES = new Set<ExecutionMode>(["step-through", "loop"]);
const NODE_STATUSES = new Set<RebuildStatus>([
  "not-started",
  "in-progress",
  "done",
  "verified",
  "needs-recheck",
]);
const SLICE_STATUSES = new Set(["not-started", "in-progress", "built", "verified"]);
const EQUIVALENCES = new Set<ContractEquivalence>(["match", "mismatch", "n/a", "unchecked"]);

/**
 * Structural validation. Returns a list of problems (empty = valid). Guarantees the
 * config enums are known, every node carries a known status, slice node-id lists
 * reference declared nodes, and loopState (when present) has sane counters. Mirrors
 * validateRebuildGraph's contract so callers can treat both the same way.
 */
export function validateRebuildState(s: unknown): string[] {
  const problems: string[] = [];
  if (typeof s !== "object" || s === null) return ["state is not an object"];
  const state = s as Partial<RebuildState>;

  if (state.version !== REBUILD_STATE_VERSION) {
    problems.push(
      `version mismatch: expected ${REBUILD_STATE_VERSION}, got ${state.version}`,
    );
  }
  if (typeof state.targetRoot !== "string" || !state.targetRoot) {
    problems.push("targetRoot missing");
  }

  const cfg = state.config;
  if (!cfg || typeof cfg !== "object") {
    problems.push("config missing");
  } else {
    if (!SCOPES.has(cfg.scope)) problems.push(`invalid config.scope: ${cfg.scope}`);
    if (!DEPTHS.has(cfg.verificationDepth)) {
      problems.push(`invalid config.verificationDepth: ${cfg.verificationDepth}`);
    }
    if (!MODES.has(cfg.executionMode)) {
      problems.push(`invalid config.executionMode: ${cfg.executionMode}`);
    }
    if (!Array.isArray(cfg.sliceOrder)) problems.push("config.sliceOrder is not an array");
  }

  const nodes = state.nodes;
  if (!nodes || typeof nodes !== "object") {
    problems.push("nodes missing");
  } else {
    for (const [id, n] of Object.entries(nodes)) {
      if (!n || typeof n !== "object") {
        problems.push(`nodes[${id}] is not an object`);
        continue;
      }
      if (!NODE_STATUSES.has(n.status)) {
        problems.push(`nodes[${id}] invalid status: ${n.status}`);
      }
      if (!Array.isArray(n.targetFiles)) problems.push(`nodes[${id}].targetFiles not an array`);
      if (!Array.isArray(n.targetIds)) problems.push(`nodes[${id}].targetIds not an array`);
      if (
        n.contractEquivalence !== undefined &&
        !EQUIVALENCES.has(n.contractEquivalence)
      ) {
        problems.push(`nodes[${id}] invalid contractEquivalence: ${n.contractEquivalence}`);
      }
    }
  }

  const slices = state.slices;
  if (!slices || typeof slices !== "object") {
    problems.push("slices missing");
  } else {
    for (const [id, sl] of Object.entries(slices)) {
      if (!sl || typeof sl !== "object") {
        problems.push(`slices[${id}] is not an object`);
        continue;
      }
      if (!SLICE_STATUSES.has(sl.status)) {
        problems.push(`slices[${id}] invalid status: ${sl.status}`);
      }
      if (!Array.isArray(sl.nodeIds)) problems.push(`slices[${id}].nodeIds not an array`);
    }
  }

  if (state.loopState !== undefined) {
    const ls = state.loopState;
    if (!ls || typeof ls !== "object") {
      problems.push("loopState is not an object");
    } else {
      if (typeof ls.enabled !== "boolean") problems.push("loopState.enabled not a boolean");
      if (typeof ls.targetPct !== "number" || ls.targetPct < 0 || ls.targetPct > 100) {
        problems.push(`loopState.targetPct out of range: ${ls.targetPct}`);
      }
      if (typeof ls.dryRounds !== "number" || ls.dryRounds < 0) {
        problems.push(`loopState.dryRounds invalid: ${ls.dryRounds}`);
      }
    }
  }

  return problems;
}

/**
 * Derive the rebuild-progress.json overlay (node id -> RebuildStatus) from the
 * state's per-node statuses. This is what `merge-rebuild-map.mjs` writes so the
 * existing dashboard lights up without reading rebuild-state.json directly.
 */
export function deriveProgressOverlay(
  state: Pick<RebuildState, "nodes">,
): Record<string, { rebuildStatus: RebuildStatus }> {
  const overlay: Record<string, { rebuildStatus: RebuildStatus }> = {};
  for (const [id, n] of Object.entries(state.nodes)) {
    // Only emit nodes that have moved off the default so the overlay stays a sparse
    // human/executor signal layered over the graph's coverage-derived defaults.
    if (n.status !== "not-started") overlay[id] = { rebuildStatus: n.status };
  }
  return overlay;
}

/** Re-export so callers importing the state schema also get the shared enums. */
export type { ContractKind, RebuildPriority, RebuildStatus };
