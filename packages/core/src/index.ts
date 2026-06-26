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
  classifyTestKind,
  REBUILD_LAYER_ORDER,
  LAYER_DOC_DIRS,
  docDirsForLayer,
  primaryDocDir,
  type RebuildLayer,
  type LayerEvidence,
  type TestDocDir,
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
  type RebuildTargetInfo,
  type RebuildVerificationSummary,
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
// --- Increment 7: rebuild execution (uw-build) ---
export {
  REBUILD_STATE_VERSION,
  validateRebuildState,
  deriveProgressOverlay,
  type RebuildState,
  type RebuildStateConfig,
  type RebuildNodeState,
  type SliceState,
  type LoopState,
  type RebuildScope,
  type VerificationDepth,
  type ExecutionMode,
  type ContractEquivalence,
} from "./graph/rebuild-state-schema.js";
export {
  REBUILD_VERIFICATION_VERSION,
  buildRebuildVerification,
  validateRebuildVerification,
  normalizeEndpointPath,
  normalizeTableName,
  endpointKey,
  type RebuildVerificationGraph,
  type VerificationNode,
  type RebuiltEdge,
  type RebuiltState,
  type ContractDiff,
  type RebuildMapping,
  type BuildVerificationInputs,
} from "./graph/rebuild-verification.js";
// --- end Increment 7 ---
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
  detectJavaEntitiesFromTree,
  detectTypeOrmEntities,
  detectSqlAlchemyModels,
  detectMongooseModels,
  detectSequelizeModels,
  detectEfCoreEntities,
  detectEndpoints,
  type DetectedContracts,
} from "./layers/contract-detectors.js";
export {
  reconcileDataModel,
  type ReconcileResult,
} from "./layers/reconcile-data-model.js";
export {
  MANIFEST_VERSION,
  emptySymbols,
  symbolId,
  validateManifest,
  type ScanManifest,
  type ManifestFile,
  type FileSymbols,
  type SymbolDefinition,
  type SymbolImport,
  type RepositoryInfo,
  type LayerIndexEntry,
  type DataModelLink,
} from "./manifest/manifest-schema.js";
