/**
 * scan-manifest.json — the single deterministic ground truth.
 *
 * Everything downstream keys off this contract: layer seeding, the coverage
 * diff, the rebuild-graph, and the dashboard. The `symbols` shape is defined in
 * full now (even though tree-sitter extraction lands in a later stage) so the
 * contract is stable and consumers never need to branch on schema version.
 *
 * Validation is hand-rolled (zero runtime deps). The structure is intentionally
 * zod-shaped so it can be swapped to a zod schema later without changing the
 * emitted JSON.
 */

import type { FileCategory } from "../scan/category-table.js";
import type { RebuildLayer } from "../layers/rebuild-layer-map.js";

export const MANIFEST_VERSION = "1.0.0";

export interface RepositoryInfo {
  type: "github" | "gitlab" | "bitbucket" | "local";
  url: string | null;
  branch: string | null;
  /** e.g. https://github.com/owner/repo/blob/main/{path}#L{start}-L{end} */
  linkFormat: string;
}

export interface SymbolFunction {
  name: string;
  startLine: number;
  endLine: number;
  params: string[];
  exported: boolean;
}

export interface SymbolClass {
  name: string;
  startLine: number;
  endLine: number;
  methods: string[];
  properties: string[];
  exported: boolean;
}

export interface SymbolExport {
  name: string;
  line: number;
  isDefault: boolean;
}

/** A structural definition: DB table, ORM entity, GraphQL type, etc. */
export interface SymbolDefinition {
  name: string;
  kind: string; // table | entity | type | enum | ...
  fields: string[];
  startLine: number;
  endLine: number;
}

export interface SymbolEndpoint {
  method: string;
  path: string;
  startLine: number;
  endLine: number;
}

/** Per-file structural symbols. All arrays default to empty. */
export interface FileSymbols {
  functions: SymbolFunction[];
  classes: SymbolClass[];
  exports: SymbolExport[];
  definitions: SymbolDefinition[];
  endpoints: SymbolEndpoint[];
}

export function emptySymbols(): FileSymbols {
  return {
    functions: [],
    classes: [],
    exports: [],
    definitions: [],
    endpoints: [],
  };
}

export interface ManifestFile {
  path: string;
  language: string;
  fileCategory: FileCategory;
  sizeLines: number;
  /** SHA-1 of the raw file bytes — drives incremental change detection. */
  contentHash: string;
  rebuildLayer: RebuildLayer;
  /** True when symbols were populated by structural extraction (vs. fallback). */
  symbolsExtracted: boolean;
  symbols: FileSymbols;
}

/** Per-layer ground-truth index: the candidate item set the specialists must cover. */
export interface LayerIndexEntry {
  files: string[];
  /** Stable symbol ids, e.g. "table:src/db/schema.ts:users". */
  symbolIds: string[];
}

export interface ManifestStats {
  totalFiles: number;
  byLanguage: Record<string, number>;
  byCategory: Record<string, number>;
  byLayer: Record<string, number>;
  symbolsExtractedFiles: number;
}

export interface ScanManifest {
  version: string;
  generatedAt: string;
  gitCommitHash: string | null;
  repository: RepositoryInfo;
  project: {
    name: string;
    languages: string[];
    estimatedComplexity: "small" | "moderate" | "large" | "very-large";
  };
  files: ManifestFile[];
  /** Internal import edges: file -> resolved internal file paths. */
  importMap: Record<string, string[]>;
  layerIndex: Record<string, LayerIndexEntry>;
  stats: ManifestStats;
}

/** Build a stable symbol id used as the join key between manifest, docs, and graph. */
export function symbolId(kind: string, filePath: string, name: string): string {
  return `${kind}:${filePath}:${name}`;
}

/** Lightweight structural validation. Returns a list of problems (empty = valid). */
export function validateManifest(m: unknown): string[] {
  const problems: string[] = [];
  if (typeof m !== "object" || m === null) return ["manifest is not an object"];
  const man = m as Partial<ScanManifest>;
  if (man.version !== MANIFEST_VERSION) {
    problems.push(`version mismatch: expected ${MANIFEST_VERSION}, got ${man.version}`);
  }
  if (!Array.isArray(man.files)) problems.push("files is not an array");
  if (typeof man.importMap !== "object" || man.importMap === null) {
    problems.push("importMap is not an object");
  }
  if (typeof man.layerIndex !== "object" || man.layerIndex === null) {
    problems.push("layerIndex is not an object");
  }
  if (Array.isArray(man.files)) {
    man.files.forEach((f, i) => {
      if (!f || typeof f.path !== "string") problems.push(`files[${i}].path missing`);
      if (f && typeof f.rebuildLayer !== "string") {
        problems.push(`files[${i}].rebuildLayer missing`);
      }
      if (f && (typeof f.symbols !== "object" || f.symbols === null)) {
        problems.push(`files[${i}].symbols missing`);
      }
    });
  }
  return problems;
}
