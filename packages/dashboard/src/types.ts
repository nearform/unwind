/**
 * Mirror of the @unwind/core rebuild-graph-schema, kept in the dashboard so the
 * build has no runtime dependency on the core package (it consumes JSON over
 * HTTP). Keep these in sync with packages/core/src/graph/rebuild-graph-schema.ts.
 */

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
export type CoverageState =
  | "scanned"
  | "documented"
  | "verified"
  | "excluded"
  | "stale";
export type RebuildStatus = "not-started" | "in-progress" | "done" | "verified";

export interface RebuildBlock {
  priority: RebuildPriority;
  contractKind: ContractKind;
  coverage: CoverageState;
  docRef: string | null;
  rebuildStatus: RebuildStatus;
}

export interface RebuildNode {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  layer: string;
  lineRange: { start: number; end: number };
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
  id: string;
  label: string;
  nodeCount: number;
}

export interface RebuildGraph {
  version: string;
  generatedAt: string;
  project: { name: string; languages: string[] };
  repository: { linkFormat: string; url: string | null; branch: string | null };
  layers: GraphLayer[];
  nodes: RebuildNode[];
  edges: RebuildEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    layerCount: number;
    byNodeType: Record<string, number>;
    byEdgeType: Record<string, number>;
    byCoverage: Record<string, number>;
    byPriority: Record<string, number>;
    coveragePct: number;
  };
}

export const ALL_NODE_TYPES: NodeType[] = [
  "file",
  "function",
  "class",
  "table",
  "endpoint",
  "contract",
];
export const ALL_COVERAGE: CoverageState[] = [
  "scanned",
  "documented",
  "verified",
  "excluded",
  "stale",
];
export const ALL_PRIORITIES: Exclude<RebuildPriority, null>[] = [
  "MUST",
  "SHOULD",
  "DON'T",
];
export const ALL_REBUILD_STATUS: RebuildStatus[] = [
  "not-started",
  "in-progress",
  "done",
  "verified",
];
export const ALL_CONTRACT_KINDS: Exclude<ContractKind, null>[] = [
  "db-table",
  "api-endpoint",
  "event-schema",
  "formula",
];

/**
 * Docs bundle — every markdown file under the project's docs/unwind, emitted by
 * build-graph.mjs alongside rebuild-graph.json. Fetched lazily by the Docs view.
 */
export interface DocFile {
  /** Path relative to docs/unwind, e.g. "layers/database/schema.md". */
  path: string;
  /** Display title (first H1, else prettified filename). */
  title: string;
  /** Sidebar grouping: "Overview" for root files, else the layer folder. */
  group: string;
  /** Raw markdown source. */
  content: string;
}

export interface DocsBundle {
  version: string;
  generatedAt: string;
  root: string;
  files: DocFile[];
}

/** Structural validation for the docs bundle before it's accepted. */
export function validateDocsBundleShape(b: unknown): string | null {
  if (!b || typeof b !== "object") return "bundle is not an object";
  const bundle = b as Partial<DocsBundle>;
  if (!Array.isArray(bundle.files)) return "files is not an array";
  for (const f of bundle.files) {
    if (!f || typeof f.path !== "string") return "a doc is missing path";
    if (typeof f.content !== "string") return `doc ${f.path} missing content`;
  }
  return null;
}

/** Build a source link from the repository link format. */
export function sourceLink(
  linkFormat: string,
  filePath: string,
  start: number,
  end: number,
): string | null {
  if (!linkFormat) return null;
  return linkFormat
    .replace("{path}", filePath)
    .replace("{start}", String(start))
    .replace("{end}", String(end));
}

/** Lightweight structural validation the loader runs before accepting a graph. */
export function validateRebuildGraphShape(g: unknown): string | null {
  if (!g || typeof g !== "object") return "graph is not an object";
  const graph = g as Partial<RebuildGraph>;
  if (!Array.isArray(graph.nodes)) return "nodes is not an array";
  if (!Array.isArray(graph.edges)) return "edges is not an array";
  if (!Array.isArray(graph.layers)) return "layers is not an array";
  if (!graph.stats || typeof graph.stats !== "object") return "stats missing";
  for (const n of graph.nodes) {
    if (!n || typeof n.id !== "string") return "a node is missing id";
    if (!n.rebuild || typeof n.rebuild !== "object") {
      return `node ${n.id} missing rebuild block`;
    }
  }
  return null;
}
