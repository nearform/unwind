/**
 * build-graph.ts — assemble rebuild-graph.json from the manifest + coverage.
 *
 * Pure function: given a manifest, the per-layer coverage reports, the parsed
 * documented items (for priority + docRef), and an optional human-progress
 * overlay, it produces a fully-joined RebuildGraph. All I/O lives in the
 * skills/scripts/build-graph.mjs wrapper so this stays unit-testable and
 * deterministic.
 *
 * Node ids reuse the candidate id scheme (candidates.ts) so they join 1:1 with
 * coverage/{layer}.json. The `rebuild` block is the fusion point:
 *   - coverage   <- coverage report (covered-by-id => verified, covered-by-fuzzy
 *                   => documented, missing => scanned)
 *   - priority   <- the [MUST]/[SHOULD]/[DON'T] tag on the documented item
 *   - docRef     <- the markdown sourceFile the item was documented in
 *   - rebuildStatus <- progress overlay (keyed by node id), default "not-started"
 */

import { basename } from "node:path";
import { candidatesByLayer, type Candidate } from "../manifest/candidates.js";
import type { ScanManifest } from "../manifest/manifest-schema.js";
import type { DocumentedItem, LayerCoverage } from "./coverage.js";
import {
  REBUILD_GRAPH_VERSION,
  type ContractKind,
  type CoverageState,
  type EdgeType,
  type GraphLayer,
  type NodeType,
  type RebuildGraph,
  type RebuildNode,
  type RebuildPriority,
  type RebuildStatus,
} from "./rebuild-graph-schema.js";

/** Human label for a layer key. */
const LAYER_LABELS: Record<string, string> = {
  database: "Database",
  domain: "Domain Model",
  service: "Service Layer",
  api: "API",
  messaging: "Messaging",
  frontend: "Frontend",
  tests: "Tests",
  infrastructure: "Infrastructure",
  unassigned: "Unassigned",
};

function layerLabel(layer: string): string {
  return LAYER_LABELS[layer] ?? layer.charAt(0).toUpperCase() + layer.slice(1);
}

/** Map a candidate kind to a graph node type. */
function nodeTypeForCandidate(kind: string): NodeType {
  switch (kind) {
    case "file":
      return "file";
    case "class":
      return "class";
    case "endpoint":
      return "endpoint";
    case "function":
      return "function";
    case "table":
    case "entity":
      return "table";
    default:
      // GraphQL types, enums, etc. are documentable contracts.
      return "contract";
  }
}

/** Map a candidate kind to a contract kind (null for non-contract nodes). */
function contractKindForCandidate(kind: string): ContractKind {
  switch (kind) {
    case "table":
    case "entity":
      return "db-table";
    case "endpoint":
      return "api-endpoint";
    case "event":
    case "event-schema":
    case "message":
      return "event-schema";
    case "formula":
    case "metric":
    case "calculation":
      return "formula";
    default:
      return null;
  }
}

export interface ProgressOverlay {
  /** node id -> rebuild status set by a human. */
  [nodeId: string]: RebuildStatus | { rebuildStatus?: RebuildStatus } | undefined;
}

function readOverlayStatus(
  overlay: ProgressOverlay | undefined,
  id: string,
): RebuildStatus | null {
  if (!overlay) return null;
  const v = overlay[id];
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.rebuildStatus) return v.rebuildStatus;
  return null;
}

export interface BuildGraphInputs {
  manifest: ScanManifest;
  /** Per-layer coverage reports, keyed by layer. */
  coverageByLayer: Record<string, LayerCoverage>;
  /**
   * All documented items across all layer docs (flattened). Used to map a node
   * id -> priority tag and docRef. Items with an explicit anchor id win; we also
   * index by normalized name for fuzzy fallback so untagged docs still attach.
   */
  documented: DocumentedItem[];
  /** Optional human-progress overlay keyed by node id. */
  progress?: ProgressOverlay;
  /**
   * Candidate ids whose source changed structurally since they were documented
   * (from detect-changes.json). Documented nodes in this set are marked
   * `coverage: "stale"`, and done/verified contracts flip to "needs-recheck".
   */
  staleIds?: string[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Build the joined rebuild graph. Deterministic; no I/O. */
export function buildRebuildGraph(
  inputs: BuildGraphInputs,
  generatedAt: string,
): RebuildGraph {
  const { manifest, coverageByLayer, documented, progress } = inputs;
  const staleIds = new Set(inputs.staleIds ?? []);

  // --- Index documented items for priority + docRef lookup. ---
  const docById = new Map<string, DocumentedItem>();
  const docByName = new Map<string, DocumentedItem>();
  for (const d of documented) {
    if (d.id && !docById.has(d.id)) docById.set(d.id, d);
    const key = norm(d.name);
    if (!docByName.has(key)) docByName.set(key, d);
  }

  // --- Index coverage: which candidate ids are covered, and by-id vs fuzzy. ---
  // A coverage report lists `missing` ids; everything else in the layer's
  // candidate set is covered. We can't tell id-vs-fuzzy per item from the
  // aggregate report, so a node is "verified" when an explicit anchor id exists
  // for it AND it isn't missing; "documented" when covered without an anchor id;
  // "scanned" when missing.
  const missingIds = new Set<string>();
  for (const cov of Object.values(coverageByLayer)) {
    for (const m of cov.missing) missingIds.add(m.id);
  }

  const byLayer = candidatesByLayer(manifest);

  const nodes: RebuildNode[] = [];
  const layerCounts: Record<string, number> = {};
  const emittedIds = new Set<string>();

  for (const [layer, candidates] of Object.entries(byLayer)) {
    for (const c of candidates) {
      // Never emit two nodes with the same id — validation rejects duplicates,
      // and identical ids carry identical edges, so the first node wins.
      if (emittedIds.has(c.id)) continue;
      emittedIds.add(c.id);
      const type = nodeTypeForCandidate(c.kind);
      const contractKind = contractKindForCandidate(c.kind);

      const doc = docById.get(c.id) ?? docByName.get(norm(c.name)) ?? null;
      const priority: RebuildPriority = doc ? doc.tag : null;
      const docRef = doc ? doc.sourceFile : null;

      const isMissing = missingIds.has(c.id);
      const isStale = staleIds.has(c.id);
      let coverage: CoverageState;
      if (priority === "DON'T") {
        coverage = "excluded";
      } else if (isMissing) {
        coverage = "scanned";
      } else if (isStale) {
        // Was documented, but the source changed structurally — flag for review.
        coverage = "stale";
      } else if (docById.has(c.id)) {
        coverage = "verified"; // covered AND has explicit anchor id
      } else {
        coverage = "documented"; // covered by fuzzy name match
      }

      const overlayStatus = readOverlayStatus(progress, c.id);
      let rebuildStatus: RebuildStatus = overlayStatus ?? defaultStatus(coverage);
      // A done/verified contract whose source changed structurally must be
      // re-confirmed by a human — never silently keep a stale "done".
      if (
        isStale &&
        contractKind !== null &&
        (rebuildStatus === "done" || rebuildStatus === "verified")
      ) {
        rebuildStatus = "needs-recheck";
      }

      nodes.push({
        id: c.id,
        type,
        name: c.name,
        filePath: c.file,
        layer,
        lineRange: { start: c.startLine, end: c.endLine },
        rebuild: {
          priority,
          contractKind,
          coverage,
          docRef,
          rebuildStatus,
        },
      });
      layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
    }
  }

  const idSet = new Set(nodes.map((n) => n.id));

  // --- Edges. ---
  const edges: { source: string; target: string; type: EdgeType }[] = [];
  const fileNodeId = new Map<string, string>(); // filePath -> file node id
  for (const n of nodes) {
    if (n.type === "file") fileNodeId.set(n.filePath, n.id);
  }

  // contains: file -> each non-file symbol it owns.
  for (const n of nodes) {
    if (n.type === "file") continue;
    const fileId = fileNodeId.get(n.filePath);
    if (fileId) edges.push({ source: fileId, target: n.id, type: "contains" });
  }

  // imports: file -> file (from the manifest import map).
  for (const [from, tos] of Object.entries(manifest.importMap)) {
    const fromId = fileNodeId.get(from);
    if (!fromId) continue;
    for (const to of tos) {
      const toId = fileNodeId.get(to);
      if (toId && fromId !== toId) {
        edges.push({ source: fromId, target: toId, type: "imports" });
      }
    }
  }

  // tested_by: source file -> test file that targets it (best-effort path convention).
  // A test "foo.test.ts" / "foo.spec.ts" / "test_foo.py" tests "foo.*".
  const testFiles = manifest.files.filter((f) => f.rebuildLayer === "tests");
  const sourceByStem = new Map<string, string[]>(); // stem -> file paths
  for (const f of manifest.files) {
    if (f.rebuildLayer === "tests") continue;
    const stem = stemOf(f.path);
    const bucket = sourceByStem.get(stem);
    if (bucket) bucket.push(f.path);
    else sourceByStem.set(stem, [f.path]);
  }
  for (const t of testFiles) {
    const testFileId = fileNodeId.get(t.path);
    if (!testFileId) continue;
    const targetStem = testTargetStem(t.path);
    if (!targetStem) continue;
    const targets = sourceByStem.get(targetStem);
    if (!targets) continue;
    for (const targetPath of targets) {
      const targetId = fileNodeId.get(targetPath);
      // edge points source-under-test -> test ("X tested_by test").
      if (targetId) {
        edges.push({ source: targetId, target: testFileId, type: "tested_by" });
      }
    }
  }

  // De-dupe edges (imports can repeat).
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    if (!idSet.has(e.source) || !idSet.has(e.target)) return false;
    const key = `${e.type}|${e.source}|${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // --- Layers metadata. ---
  const layers: GraphLayer[] = Object.keys(layerCounts)
    .sort()
    .map((id) => ({ id, label: layerLabel(id), nodeCount: layerCounts[id] }));

  // --- Stats. ---
  const byNodeType: Record<string, number> = {};
  const byCoverage: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const n of nodes) {
    byNodeType[n.type] = (byNodeType[n.type] ?? 0) + 1;
    byCoverage[n.rebuild.coverage] = (byCoverage[n.rebuild.coverage] ?? 0) + 1;
    const p = n.rebuild.priority ?? "none";
    byPriority[p] = (byPriority[p] ?? 0) + 1;
  }
  const byEdgeType: Record<string, number> = {};
  for (const e of uniqueEdges) {
    byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1;
  }
  const documentedOrVerified =
    (byCoverage["documented"] ?? 0) + (byCoverage["verified"] ?? 0);
  const coveragePct =
    nodes.length === 0
      ? 100
      : Math.round((documentedOrVerified / nodes.length) * 1000) / 10;

  return {
    version: REBUILD_GRAPH_VERSION,
    generatedAt,
    project: {
      name: manifest.project.name,
      languages: manifest.project.languages,
    },
    repository: {
      linkFormat: manifest.repository.linkFormat,
      url: manifest.repository.url,
      branch: manifest.repository.branch,
    },
    layers,
    nodes,
    edges: uniqueEdges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: uniqueEdges.length,
      layerCount: layers.length,
      byNodeType,
      byEdgeType,
      byCoverage,
      byPriority,
      coveragePct,
    },
  };
}

/** Default rebuild status from coverage when no human overlay is present. */
function defaultStatus(coverage: CoverageState): RebuildStatus {
  switch (coverage) {
    case "verified":
      return "verified";
    case "documented":
      return "done";
    case "excluded":
      return "done"; // intentionally out of scope counts as resolved
    default:
      return "not-started";
  }
}

/** File stem without directory or extension(s) for test<->source matching. */
function stemOf(path: string): string {
  const base = basename(path);
  // strip a single trailing extension; keep compound names intact otherwise.
  return base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

/**
 * Given a test file path, derive the stem of the source file it likely tests.
 * Handles: foo.test.ts / foo.spec.ts / foo.e2e.ts / foo_test.go / test_foo.py.
 * Returns null when no convention matches.
 */
function testTargetStem(path: string): string | null {
  const base = basename(path);
  let m = base.match(/^(.+?)\.(test|spec|e2e)\.[a-z0-9]+$/i);
  if (m) return m[1].toLowerCase();
  m = base.match(/^(.+?)_test\.[a-z0-9]+$/i);
  if (m) return m[1].toLowerCase();
  m = base.match(/^test_(.+?)\.[a-z0-9]+$/i);
  if (m) return m[1].toLowerCase();
  return null;
}
