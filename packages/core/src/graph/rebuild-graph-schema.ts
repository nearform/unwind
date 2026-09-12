/**
 * rebuild-graph.json — the knowledge-graph artifact the dashboard consumes.
 *
 * This is the second deterministic artifact (after scan-manifest.json). Where the
 * manifest is a flat file/symbol inventory, the rebuild graph is the *joined*
 * view: nodes (files + their symbols) carry a `rebuild` block that fuses three
 * inputs — the manifest (structure), the coverage diff (what's documented), and
 * the layer markdown (priority + doc refs) — plus an optional human-progress
 * overlay. Edges express containment, imports, contract-of, and test relations.
 *
 * The node ids are the SAME stable candidate ids minted by candidates.ts
 * (`function:path:name`, `class:...`, `table:...`, `endpoint:...`, `file:...`),
 * so the graph joins cleanly with coverage/{layer}.json without re-deriving ids.
 *
 * Validation is hand-rolled (zero runtime deps), matching manifest-schema.ts.
 */

export const REBUILD_GRAPH_VERSION = "1.0.0";

export type NodeType =
  | "file"
  | "function"
  | "class"
  | "table"
  | "endpoint"
  | "contract";

export type EdgeType =
  | "contains"
  | "imports"
  | "derives_from"
  | "contract_of"
  | "tested_by";

export type RebuildPriority = "MUST" | "SHOULD" | "DON'T" | null;

export type ContractKind =
  | "db-table"
  | "api-endpoint"
  | "event-schema"
  | "formula"
  | null;

/**
 * Coverage state of a node, derived from coverage/{layer}.json:
 *  - scanned:    present in the manifest, not yet documented
 *  - documented: has a documented match (by id or fuzzy)
 *  - verified:   documented AND the doc carries an explicit anchor id (id-match)
 *  - excluded:   intentionally out of scope (e.g. DON'T-priority items)
 *  - stale:      documented but no longer present in the scan (orphan doc)
 */
export type CoverageState =
  | "scanned"
  | "documented"
  | "verified"
  | "excluded"
  | "stale";

export type RebuildStatus =
  | "not-started"
  | "in-progress"
  | "done"
  | "verified"
  /** Was done/verified, but the underlying source changed structurally
   *  (set by incremental detect-changes) — a human must re-confirm. */
  | "needs-recheck";

/**
 * Where a source node was rebuilt to in the TARGET stack — the "build assets".
 * Folded in (when present) from rebuild-state.json (`targetFiles`/`targetIds`) and
 * rebuild-verification-graph.json (`rebuiltState`). Absent until `uw-build` runs.
 */
export interface RebuildTargetInfo {
  /** Target file paths the source node was rebuilt into (relative to the target root). */
  files: string[];
  /** Target candidate ids (kind:path:name), when known. */
  ids?: string[];
  /**
   * Verification verdict from rebuild-verification-graph.json, if verified:
   * missing | claimed | present | equivalent | divergent | excluded.
   */
  state?: string | null;
  /** True once the target file(s) were confirmed by a re-scan of the target repo. */
  confirmed?: boolean;
}

/** The fused rebuild metadata attached to every node. */
export interface RebuildBlock {
  priority: RebuildPriority;
  contractKind: ContractKind;
  coverage: CoverageState;
  /** Source markdown file (relative path) the node was documented in, if any. */
  docRef: string | null;
  rebuildStatus: RebuildStatus;
  /** Target-side mapping, present only after a rebuild (`uw-build`). */
  target?: RebuildTargetInfo | null;
}

/**
 * Grill risk overlay — the "is this worth rebuilding?" layer.
 *
 * Folded in (when present) from .cache/grill-findings.json, produced by
 * `uw-grill`. Where `coverage` says an item is DOCUMENTED and `target` says it
 * was REBUILT, `risk` says a human questioned whether the behaviour it
 * describes should be reproduced at all. Absent until `uw-grill` runs.
 */
export type RiskSeverity = "high" | "medium" | "low";

export type RiskVerdict =
  /** Correct and intentional — rebuild faithfully. */
  | "preserve"
  /** Reproduce the intent, not the defect; the correction is in the doc body. */
  | "fix-in-rebuild"
  /** Obsolete — do not rebuild (retagged [DON'T]). */
  | "drop"
  /** Not contract-critical after all (retagged [SHOULD]). */
  | "downgrade"
  /** Too thin to rebuild from; routed back to uw-complete. */
  | "document-first"
  /** Routed to a different owner; still open. */
  | "reassign";

export interface NodeRisk {
  severity: RiskSeverity;
  /** Highest-precedence verdict across this node's findings; null while open. */
  verdict: RiskVerdict | null;
  /** Question ids (GQ-nnnn) — cross-reference into docs/unwind/questions/. */
  findings: string[];
  /** Finding categories, e.g. ["magic-constant","thin-spec"]. */
  categories: string[];
  /** Findings on this node still awaiting an answer. */
  openCount: number;
}

/** Graph-level roll-up of the grill pass. */
export interface RiskSummary {
  generatedAt: string | null;
  total: number;
  /** Findings with no verdict yet — the honest output of an unfinished grill. */
  openCount: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byVerdict: Record<string, number>;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface RebuildNode {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  layer: string;
  lineRange: LineRange;
  summary?: string;
  tags?: string[];
  rebuild: RebuildBlock;
  /**
   * Grill findings attached to this node. Deliberately a sibling of `rebuild`,
   * not a field inside it: different provenance (a human interview, not the
   * manifest/coverage/docs fusion) and a different lifecycle.
   */
  risk?: NodeRisk | null;
}

export interface RebuildEdge {
  source: string;
  target: string;
  type: EdgeType;
}

export interface GraphLayer {
  /** Layer key, e.g. "database". */
  id: string;
  /** Human label, e.g. "Database". */
  label: string;
  nodeCount: number;
}

export interface RebuildGraphStats {
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  byNodeType: Record<string, number>;
  byEdgeType: Record<string, number>;
  byCoverage: Record<string, number>;
  byPriority: Record<string, number>;
  /** documented+verified / total, as a percentage. */
  coveragePct: number;
}

/**
 * Headline rebuild-verification summary, folded in after `uw-build` from
 * rebuild-verification-graph.json. Drives the dashboard's Rebuild view; absent
 * until the target repo has been verified (`verify-rebuild.mjs`).
 */
export interface RebuildVerificationSummary {
  /** The rebuilt target project (name, root path, detected languages). */
  targetProject: { name: string; root: string; languages: string[] } | null;
  totalMust: number;
  mustEquivalentOrPresent: number;
  completenessPct: number;
  /** rebuilt-state -> count (present, equivalent, missing, divergent, excluded, claimed). */
  byRebuiltState: Record<string, number>;
  /** When the verification graph was generated. */
  generatedAt: string | null;
}

export interface RebuildGraph {
  version: string;
  generatedAt: string;
  project: {
    name: string;
    languages: string[];
  };
  /** Rebuild-verification summary, present only after a verified rebuild. */
  rebuildVerification?: RebuildVerificationSummary | null;
  /** Grill roll-up, present only after `uw-grill` has produced findings. */
  riskSummary?: RiskSummary | null;
  repository: {
    /** Carried from the manifest so the dashboard can render source links. */
    linkFormat: string;
    url: string | null;
    branch: string | null;
  };
  layers: GraphLayer[];
  nodes: RebuildNode[];
  edges: RebuildEdge[];
  stats: RebuildGraphStats;
}

const NODE_TYPES = new Set<NodeType>([
  "file",
  "function",
  "class",
  "table",
  "endpoint",
  "contract",
]);
const EDGE_TYPES = new Set<EdgeType>([
  "contains",
  "imports",
  "derives_from",
  "contract_of",
  "tested_by",
]);
const PRIORITIES = new Set(["MUST", "SHOULD", "DON'T"]);
const RISK_SEVERITIES = new Set<RiskSeverity>(["high", "medium", "low"]);
const RISK_VERDICTS = new Set<RiskVerdict>([
  "preserve",
  "fix-in-rebuild",
  "drop",
  "downgrade",
  "document-first",
  "reassign",
]);
const COVERAGE_STATES = new Set<CoverageState>([
  "scanned",
  "documented",
  "verified",
  "excluded",
  "stale",
]);
const REBUILD_STATUSES = new Set<RebuildStatus>([
  "not-started",
  "in-progress",
  "done",
  "verified",
  "needs-recheck",
]);

/**
 * Structural validation. Returns a list of problems (empty = valid). Guarantees:
 * unique node ids, no dangling edges (both endpoints exist), every node carries a
 * complete `rebuild` block with `priority` explicitly set (a value or null), and
 * known enum values throughout.
 */
export function validateRebuildGraph(g: unknown): string[] {
  const problems: string[] = [];
  if (typeof g !== "object" || g === null) return ["graph is not an object"];
  const graph = g as Partial<RebuildGraph>;

  if (graph.version !== REBUILD_GRAPH_VERSION) {
    problems.push(
      `version mismatch: expected ${REBUILD_GRAPH_VERSION}, got ${graph.version}`,
    );
  }
  if (!Array.isArray(graph.nodes)) problems.push("nodes is not an array");
  if (!Array.isArray(graph.edges)) problems.push("edges is not an array");
  if (!Array.isArray(graph.layers)) problems.push("layers is not an array");

  const ids = new Set<string>();
  if (Array.isArray(graph.nodes)) {
    graph.nodes.forEach((n, i) => {
      if (!n || typeof n.id !== "string" || !n.id) {
        problems.push(`nodes[${i}].id missing`);
        return;
      }
      if (ids.has(n.id)) problems.push(`duplicate node id: ${n.id}`);
      ids.add(n.id);
      if (!NODE_TYPES.has(n.type)) {
        problems.push(`nodes[${i}] (${n.id}) invalid type: ${n.type}`);
      }
      if (typeof n.name !== "string") {
        problems.push(`nodes[${i}] (${n.id}) name missing`);
      }
      const r = n.rebuild;
      if (!r || typeof r !== "object") {
        problems.push(`nodes[${i}] (${n.id}) rebuild block missing`);
      } else {
        // priority MUST be present as a key, set to a value or explicit null.
        if (!("priority" in r)) {
          problems.push(`nodes[${i}] (${n.id}) rebuild.priority not set`);
        } else if (r.priority !== null && !PRIORITIES.has(r.priority)) {
          problems.push(
            `nodes[${i}] (${n.id}) invalid rebuild.priority: ${r.priority}`,
          );
        }
        if (r.contractKind !== null && (r.contractKind as string) !== undefined) {
          const ok =
            r.contractKind === null ||
            ["db-table", "api-endpoint", "event-schema", "formula"].includes(
              r.contractKind as string,
            );
          if (!ok) {
            problems.push(
              `nodes[${i}] (${n.id}) invalid rebuild.contractKind: ${r.contractKind}`,
            );
          }
        }
        if (!COVERAGE_STATES.has(r.coverage)) {
          problems.push(
            `nodes[${i}] (${n.id}) invalid rebuild.coverage: ${r.coverage}`,
          );
        }
        if (!REBUILD_STATUSES.has(r.rebuildStatus)) {
          problems.push(
            `nodes[${i}] (${n.id}) invalid rebuild.rebuildStatus: ${r.rebuildStatus}`,
          );
        }
      }
      // `risk` is optional (absent until uw-grill runs) — validate only when present.
      if (n.risk !== undefined && n.risk !== null) {
        const k = n.risk;
        if (!RISK_SEVERITIES.has(k.severity)) {
          problems.push(`nodes[${i}] (${n.id}) invalid risk.severity: ${k.severity}`);
        }
        if (k.verdict !== null && k.verdict !== undefined && !RISK_VERDICTS.has(k.verdict)) {
          problems.push(`nodes[${i}] (${n.id}) invalid risk.verdict: ${k.verdict}`);
        }
        if (!Array.isArray(k.findings) || k.findings.length === 0) {
          problems.push(`nodes[${i}] (${n.id}) risk.findings must be a non-empty array`);
        }
      }
    });
  }

  if (Array.isArray(graph.edges)) {
    graph.edges.forEach((e, i) => {
      if (!e || typeof e !== "object") {
        problems.push(`edges[${i}] is not an object`);
        return;
      }
      if (!EDGE_TYPES.has(e.type)) {
        problems.push(`edges[${i}] invalid type: ${e.type}`);
      }
      if (!ids.has(e.source)) {
        problems.push(`edges[${i}] dangling source: ${e.source}`);
      }
      if (!ids.has(e.target)) {
        problems.push(`edges[${i}] dangling target: ${e.target}`);
      }
    });
  }

  return problems;
}
