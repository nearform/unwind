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

/** The fused rebuild metadata attached to every node. */
export interface RebuildBlock {
  priority: RebuildPriority;
  contractKind: ContractKind;
  coverage: CoverageState;
  /** Source markdown file (relative path) the node was documented in, if any. */
  docRef: string | null;
  rebuildStatus: RebuildStatus;
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

export interface RebuildGraph {
  version: string;
  generatedAt: string;
  project: {
    name: string;
    languages: string[];
  };
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
