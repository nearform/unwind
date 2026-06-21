/**
 * @unwind/core — deterministic ground-truth engine for the Unwind plugin.
 *
 * Public surface consumed by skills/scripts/*.mjs and the dashboard.
 */

export { detectLanguage } from "./scan/language-table.js";
export {
  detectCategory,
  estimateComplexity,
  type FileCategory,
} from "./scan/category-table.js";
export { enumerateFiles, type EnumeratedFile } from "./scan/enumerate.js";
export { getRepositoryInfo, getCommitHash } from "./scan/repo-info.js";
export { buildImportMap } from "./imports/import-map.js";
export {
  classifyRebuildLayer,
  REBUILD_LAYER_ORDER,
  type RebuildLayer,
  type LayerEvidence,
} from "./layers/rebuild-layer-map.js";
export {
  buildManifest,
  type BuildManifestOptions,
  type SymbolExtractor,
} from "./manifest/build-manifest.js";
export { TreeSitterPlugin, toFileSymbols } from "./structure/tree-sitter-plugin.js";
export {
  fileCandidates,
  candidatesByLayer,
  sourceLink,
  type Candidate,
} from "./manifest/candidates.js";
export {
  extractDocumentedItems,
  computeLayerCoverage,
  type DocumentedItem,
  type LayerCoverage,
  type MissingItem,
} from "./graph/coverage.js";
// --- Increment 4: rebuild graph ---
export {
  buildRebuildGraph,
  type BuildGraphInputs,
  type ProgressOverlay,
} from "./graph/build-graph.js";
export {
  REBUILD_GRAPH_VERSION,
  validateRebuildGraph,
  type RebuildGraph,
  type RebuildNode,
  type RebuildEdge,
  type RebuildBlock,
  type GraphLayer,
  type RebuildGraphStats,
  type NodeType,
  type EdgeType,
  type RebuildPriority,
  type ContractKind,
  type CoverageState,
  type RebuildStatus,
  type LineRange,
} from "./graph/rebuild-graph-schema.js";
// --- end Increment 4 ---
// --- Increment 6: incremental fingerprints ---
export {
  computeFileFingerprint,
  buildFingerprints,
  classifyChanges,
  hasActionableChanges,
  type FileFingerprint,
  type ChangeSet,
  type ChangeKind,
} from "./fingerprint/fingerprint.js";
// --- end Increment 6 ---
// --- Increment 3: contract detection ---
export {
  detectContracts,
  detectSqlTables,
  detectPrismaModels,
  detectDrizzleFromTree,
  detectDrizzleFromText,
  detectJpaEntities,
  detectEndpoints,
  type DetectedContracts,
} from "./layers/contract-detectors.js";
export {
  MANIFEST_VERSION,
  emptySymbols,
  symbolId,
  validateManifest,
  type ScanManifest,
  type ManifestFile,
  type FileSymbols,
  type RepositoryInfo,
  type LayerIndexEntry,
} from "./manifest/manifest-schema.js";
