/**
 * rebuild-verification.ts — the before/after picture.
 *
 * The source repo already has a tree-sitter graph (rebuild-graph.json). After a
 * rebuild slice, the TARGET repo is re-scanned into its own manifest. This module
 * JOINS the two via the agent-recorded source→target mapping and measures how much
 * of the source actually came across — the headline "completeness" number — using
 * the same deterministic set arithmetic the rest of Unwind relies on.
 *
 * Two tiers of confirmation, and we are honest about the difference:
 *   - STRUCTURAL (present):  the mapped target candidate actually exists in the
 *                            target scan — the agent really wrote it, not a stub claim.
 *   - CONTRACT (equivalent): present AND a deterministic cross-manifest diff matches.
 *     Only the *routing surface* (endpoint method+path) and the *data-model shape*
 *     (table + field names) are checkable from a manifest. Field TYPES are not in the
 *     manifest (`fields` is string[]); business rules / response bodies are not
 *     structural. Those stay `present`, never auto-`equivalent` — prove them with
 *     run-tests depth, not here.
 *
 * Pure function (no I/O); the skills/scripts/verify-rebuild.mjs wrapper owns scanning
 * the target repo and writing the artifact. Validation is hand-rolled (zero deps).
 */

import {
  symbolId,
  type ScanManifest,
  type SymbolDefinition,
  type SymbolEndpoint,
} from "../manifest/manifest-schema.js";
import { fileCandidates } from "../manifest/candidates.js";
import type {
  ContractKind,
  RebuildGraph,
  RebuildPriority,
} from "./rebuild-graph-schema.js";

export const REBUILD_VERIFICATION_VERSION = "1.0.0";

/**
 * How a source node fared in the rebuilt target:
 *  - missing:    no source→target mapping at all (the rebuild skipped it)
 *  - claimed:    mapped, but the target scan does NOT contain the target id (stub/over-claim)
 *  - present:    the mapped target candidate exists in the target scan (structural)
 *  - equivalent: present AND the deterministic contract diff matches (proven)
 *  - divergent:  present BUT the contract diff found a mismatch (built wrong)
 *  - excluded:   [DON'T]-priority — intentionally not rebuilt
 */
export type RebuiltState =
  | "missing"
  | "claimed"
  | "present"
  | "equivalent"
  | "divergent"
  | "excluded";

export interface ContractDiff {
  kind: "endpoint" | "table";
  /** Endpoints: did HTTP method match after normalization. */
  methodMatch?: boolean;
  /** Endpoints: did the param-normalized path match. */
  pathMatch?: boolean;
  /** Tables: source field names absent in the target (the gaps). */
  missingFields?: string[];
  /** Tables: target field names not present in the source. */
  extraFields?: string[];
  /** Tables: Jaccard overlap of normalized field sets (0..1) — mapping sanity check. */
  fieldOverlap?: number;
}

export interface VerificationNode {
  sourceId: string;
  layer: string;
  priority: RebuildPriority;
  contractKind: ContractKind;
  rebuiltState: RebuiltState;
  /** Mapped target candidate ids (kind:path:name in the target manifest). */
  targetIds: string[];
  /** For contract nodes: what the deterministic diff found. */
  diff?: ContractDiff;
}

export interface RebuiltEdge {
  sourceId: string;
  targetId: string;
  type: "rebuilt_as";
}

export interface RebuildVerificationGraph {
  version: string;
  generatedAt: string;
  sourceProject: { name: string; languages: string[] };
  targetProject: { name: string; languages: string[]; root: string };
  nodes: VerificationNode[];
  edges: RebuiltEdge[];
  stats: {
    totalMust: number;
    /** [MUST] nodes that are present or equivalent — the completeness numerator. */
    mustEquivalentOrPresent: number;
    /** mustEquivalentOrPresent / totalMust, as a percentage (100 when totalMust=0). */
    completenessPct: number;
    byRebuiltState: Record<string, number>;
  };
}

/** One source→target mapping record (the agent's per-slice claim, merged). */
export interface RebuildMapping {
  sourceId: string;
  targetFiles: string[];
  targetIds: string[];
}

export interface BuildVerificationInputs {
  sourceGraph: RebuildGraph;
  /** Source manifest — supplies field/method/path detail the graph node lacks. */
  sourceManifest: ScanManifest;
  /** Fresh scan of the rebuilt target repo. */
  targetManifest: ScanManifest;
  /** Merged source→target mappings (from rebuild-map/*.json via merge-rebuild-map). */
  mappings: RebuildMapping[];
  /**
   * When the rebuild deliberately changed API style (REST→tRPC/GraphQL, per
   * rebuild-decisions.json), an endpoint method+path diff is meaningless — skip it
   * and fall back to structural `present`. Default false.
   */
  apiStyleChanged?: boolean;
}

/**
 * Normalize a name for comparison: lowercase, strip non-alphanumeric. Matches the
 * `norm()` used in coverage.ts and build-graph.ts so cross-stack snake_case ↔
 * camelCase ↔ PascalCase collapse to the same key (user_accounts ≡ userAccounts).
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Collapse a route path's parameter syntax so the SAME route compares equal across
 * frameworks: `:id` (Express/Hono), `{id}` (OpenAPI/Spring), `<id>`/`<int:id>`
 * (Flask), `[id]`/`[...slug]` (Next) all become `{}`. Param NAMES are blanked
 * (renaming `:userId`→`:id` is contract-equivalent for routing). Trailing slash and
 * any query string are stripped. Static segment CASE is preserved — paths are
 * case-sensitive contracts.
 */
export function normalizeEndpointPath(path: string): string {
  if (!path) return "/";
  // Drop the route-optional marker (`:id?`) BEFORE the query strip below, else its
  // `?` is mistaken for a query string. A real query `?k=v` has no leading `:name`.
  let p = path.replace(/(:[A-Za-z0-9_]+)\?(?=\/|$)/g, "$1");
  // Drop query/fragment and a single trailing slash (but keep root "/").
  p = p.split(/[?#]/)[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (!p.startsWith("/")) p = "/" + p;
  const segments = p.split("/").map((seg) => {
    if (seg === "") return seg;
    // :param / :param? (Express, Hono, Fastify, NestJS)
    if (/^:.+/.test(seg)) return "{}";
    // {param} (OpenAPI, Spring, ASP.NET)
    if (/^\{.+\}$/.test(seg)) return "{}";
    // <param> or <converter:param> (Flask, Werkzeug)
    if (/^<.+>$/.test(seg)) return "{}";
    // [param] / [...param] / [[...param]] (Next.js, Nuxt file routing)
    if (/^\[\[?\.{0,3}.+\]\]?$/.test(seg)) return "{}";
    // $param (Remix) — keep static-looking $ segments out by requiring a name.
    if (/^\$.+/.test(seg)) return "{}";
    // *wildcard / * (catch-all)
    if (seg === "*" || /^\*.+/.test(seg)) return "{}";
    return seg;
  });
  const out = segments.join("/");
  return out === "" ? "/" : out;
}

/** Canonical match key for an endpoint: `METHOD <normalized-path>`. */
export function endpointKey(method: string, path: string): string {
  const m = method.toUpperCase();
  return `${m} ${normalizeEndpointPath(path)}`;
}

/** Normalized identity for a table/entity: prefer the physical name when present. */
export function normalizeTableName(def: { name: string; physicalName?: string }): string {
  return norm(def.physicalName ?? def.name);
}

/** Jaccard overlap of two normalized field-name sets (0 when both empty → 1). */
function fieldJaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Index a manifest's structural definitions/endpoints by candidate id. */
function indexContracts(manifest: ScanManifest): {
  defs: Map<string, SymbolDefinition>;
  endpoints: Map<string, SymbolEndpoint>;
  candidateIds: Set<string>;
} {
  const defs = new Map<string, SymbolDefinition>();
  const endpoints = new Map<string, SymbolEndpoint>();
  const candidateIds = new Set<string>();
  for (const file of manifest.files) {
    for (const c of fileCandidates(file)) candidateIds.add(c.id);
    for (const d of file.symbols.definitions) {
      defs.set(symbolId(d.kind, file.path, d.name), d);
    }
    for (const e of file.symbols.endpoints) {
      endpoints.set(symbolId("endpoint", file.path, `${e.method} ${e.path}`), e);
    }
  }
  return { defs, endpoints, candidateIds };
}

const FIELD_OVERLAP_THRESHOLD = 0.5;

/**
 * Build the rebuild verification graph: join the source graph against a fresh scan
 * of the rebuilt target via the recorded mappings, and classify each source node.
 */
export function buildRebuildVerification(
  inputs: BuildVerificationInputs,
  generatedAt: string,
): RebuildVerificationGraph {
  const { sourceGraph, sourceManifest, targetManifest, mappings, apiStyleChanged } = inputs;

  const mapBySource = new Map<string, RebuildMapping>();
  for (const m of mappings) if (!mapBySource.has(m.sourceId)) mapBySource.set(m.sourceId, m);

  const src = indexContracts(sourceManifest);
  const tgt = indexContracts(targetManifest);

  const nodes: VerificationNode[] = [];
  const edges: RebuiltEdge[] = [];

  for (const n of sourceGraph.nodes) {
    const mapping = mapBySource.get(n.id);
    const targetIds = mapping?.targetIds ?? [];
    const priority = n.rebuild.priority;
    const contractKind = n.rebuild.contractKind;

    let rebuiltState: RebuiltState;
    let diff: ContractDiff | undefined;

    if (priority === "DON'T") {
      rebuiltState = "excluded";
    } else if (!mapping || targetIds.length === 0) {
      rebuiltState = "missing";
    } else {
      // Which mapped target ids actually exist in the target scan?
      const presentTargetIds = targetIds.filter((id) => tgt.candidateIds.has(id));
      for (const tid of presentTargetIds) {
        edges.push({ sourceId: n.id, targetId: tid, type: "rebuilt_as" });
      }
      if (presentTargetIds.length === 0) {
        rebuiltState = "claimed"; // mapped but nothing real in the target
      } else if (contractKind === "api-endpoint") {
        diff = diffEndpoint(n.id, presentTargetIds, src, tgt, apiStyleChanged ?? false);
        rebuiltState = endpointVerdict(diff, apiStyleChanged ?? false);
      } else if (contractKind === "db-table") {
        diff = diffTable(n.id, presentTargetIds, src, tgt);
        rebuiltState = tableVerdict(diff);
      } else {
        // Non-contract node (file/function/class) or a contract kind we can't diff
        // structurally (event-schema/formula) — presence is all we can assert.
        rebuiltState = "present";
      }
    }

    nodes.push({
      sourceId: n.id,
      layer: n.layer,
      priority,
      contractKind,
      rebuiltState,
      targetIds,
      ...(diff ? { diff } : {}),
    });
  }

  // --- Stats: completeness over [MUST]. ---
  const byRebuiltState: Record<string, number> = {};
  let totalMust = 0;
  let mustEquivalentOrPresent = 0;
  for (const node of nodes) {
    byRebuiltState[node.rebuiltState] = (byRebuiltState[node.rebuiltState] ?? 0) + 1;
    if (node.priority === "MUST") {
      totalMust++;
      if (node.rebuiltState === "present" || node.rebuiltState === "equivalent") {
        mustEquivalentOrPresent++;
      }
    }
  }
  const completenessPct =
    totalMust === 0
      ? 100
      : Math.round((mustEquivalentOrPresent / totalMust) * 1000) / 10;

  return {
    version: REBUILD_VERIFICATION_VERSION,
    generatedAt,
    sourceProject: {
      name: sourceGraph.project.name,
      languages: sourceGraph.project.languages,
    },
    targetProject: {
      name: targetManifest.project.name,
      languages: targetManifest.project.languages,
      root: targetManifest.repository.url ?? "",
    },
    nodes,
    edges,
    stats: {
      totalMust,
      mustEquivalentOrPresent,
      completenessPct,
      byRebuiltState,
    },
  };
}

/** Diff a source endpoint against its mapped target endpoint(s). */
function diffEndpoint(
  sourceId: string,
  presentTargetIds: string[],
  src: ReturnType<typeof indexContracts>,
  tgt: ReturnType<typeof indexContracts>,
  apiStyleChanged: boolean,
): ContractDiff {
  const sEp = src.endpoints.get(sourceId);
  if (!sEp || apiStyleChanged) {
    // No source detail, or API style deliberately changed — nothing meaningful to diff.
    return { kind: "endpoint" };
  }
  const wantKey = endpointKey(sEp.method, sEp.path);
  // Any mapped+present target endpoint whose normalized key matches?
  for (const tid of presentTargetIds) {
    const tEp = tgt.endpoints.get(tid);
    if (!tEp) continue;
    const methodMatch = tEp.method.toUpperCase() === sEp.method.toUpperCase();
    const pathMatch = normalizeEndpointPath(tEp.path) === normalizeEndpointPath(sEp.path);
    if (methodMatch && pathMatch) return { kind: "endpoint", methodMatch: true, pathMatch: true };
  }
  // No exact match — report against the first mapped endpoint (best-effort detail).
  const firstTgt = presentTargetIds.map((id) => tgt.endpoints.get(id)).find(Boolean);
  void wantKey;
  return {
    kind: "endpoint",
    methodMatch: firstTgt ? firstTgt.method.toUpperCase() === sEp.method.toUpperCase() : false,
    pathMatch: firstTgt ? normalizeEndpointPath(firstTgt.path) === normalizeEndpointPath(sEp.path) : false,
  };
}

function endpointVerdict(diff: ContractDiff, apiStyleChanged: boolean): RebuiltState {
  // Can't diff (no source detail or style changed) → structural presence only.
  if (apiStyleChanged || (diff.methodMatch === undefined && diff.pathMatch === undefined)) {
    return "present";
  }
  return diff.methodMatch && diff.pathMatch ? "equivalent" : "divergent";
}

/** Diff a source table against its mapped target table(s). */
function diffTable(
  sourceId: string,
  presentTargetIds: string[],
  src: ReturnType<typeof indexContracts>,
  tgt: ReturnType<typeof indexContracts>,
): ContractDiff {
  const sDef = src.defs.get(sourceId);
  if (!sDef) return { kind: "table" };
  // Choose the best target table: highest field overlap among mapped+present defs.
  let best: { def: SymbolDefinition; overlap: number } | null = null;
  for (const tid of presentTargetIds) {
    const tDef = tgt.defs.get(tid);
    if (!tDef) continue;
    const overlap = fieldJaccard(sDef.fields, tDef.fields);
    if (!best || overlap > best.overlap) best = { def: tDef, overlap };
  }
  if (!best) return { kind: "table" };
  const tFields = new Set(best.def.fields.map(norm));
  const sFields = new Set(sDef.fields.map(norm));
  const missingFields = sDef.fields.filter((f) => !tFields.has(norm(f)));
  const extraFields = best.def.fields.filter((f) => !sFields.has(norm(f)));
  return {
    kind: "table",
    missingFields,
    extraFields,
    fieldOverlap: Math.round(best.overlap * 1000) / 1000,
  };
}

function tableVerdict(diff: ContractDiff): RebuiltState {
  // No source detail to diff → structural presence only.
  if (diff.missingFields === undefined) return "present";
  // A mapping with near-zero field overlap is likely a wrong/incomplete build.
  if ((diff.fieldOverlap ?? 0) < FIELD_OVERLAP_THRESHOLD) return "divergent";
  // Every source field present in the target → equivalent shape. Extra target
  // fields are allowed (the rebuild may add columns) and don't fail equivalence.
  return (diff.missingFields?.length ?? 0) === 0 ? "equivalent" : "divergent";
}

const REBUILT_STATES = new Set<RebuiltState>([
  "missing",
  "claimed",
  "present",
  "equivalent",
  "divergent",
  "excluded",
]);

/** Structural validation of a verification graph. Returns problems (empty = valid). */
export function validateRebuildVerification(g: unknown): string[] {
  const problems: string[] = [];
  if (typeof g !== "object" || g === null) return ["graph is not an object"];
  const graph = g as Partial<RebuildVerificationGraph>;
  if (graph.version !== REBUILD_VERIFICATION_VERSION) {
    problems.push(`version mismatch: expected ${REBUILD_VERIFICATION_VERSION}, got ${graph.version}`);
  }
  if (!Array.isArray(graph.nodes)) problems.push("nodes is not an array");
  else {
    graph.nodes.forEach((n, i) => {
      if (!n || typeof n.sourceId !== "string") problems.push(`nodes[${i}].sourceId missing`);
      else if (!REBUILT_STATES.has(n.rebuiltState)) {
        problems.push(`nodes[${i}] (${n.sourceId}) invalid rebuiltState: ${n.rebuiltState}`);
      }
    });
  }
  if (!Array.isArray(graph.edges)) problems.push("edges is not an array");
  if (!graph.stats || typeof graph.stats !== "object") problems.push("stats missing");
  return problems;
}
