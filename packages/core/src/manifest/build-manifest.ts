/**
 * Assemble scan-manifest.json from deterministic inputs.
 *
 * Orchestrates: enumerate -> language/category -> structural symbols (pluggable)
 * -> rebuild-layer classification -> import map -> per-layer index -> stats.
 *
 * The symbol extractor is injected so tree-sitter can be added in a later stage
 * without touching this orchestration. When no extractor is supplied, files get
 * empty symbols (symbolsExtracted=false) and the layer index falls back to
 * file-level coverage ids — the completeness contract still holds at file grain.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { enumerateFiles } from "../scan/enumerate.js";
import { detectLanguage } from "../scan/language-table.js";
import { detectCategory, estimateComplexity } from "../scan/category-table.js";
import { getRepositoryInfo, getCommitHash } from "../scan/repo-info.js";
import { buildImportMap } from "../imports/import-map.js";
import {
  classifyRebuildLayer,
  type RebuildLayer,
} from "../layers/rebuild-layer-map.js";
import {
  emptySymbols,
  MANIFEST_VERSION,
  type FileSymbols,
  type ManifestFile,
  type ScanManifest,
  type LayerIndexEntry,
} from "./manifest-schema.js";
import { fileCandidates } from "./candidates.js";

/** Inject a structural extractor; return null to signal "no parser matched". */
export type SymbolExtractor = (
  file: { path: string; language: string; fileCategory: string },
  content: string,
) => FileSymbols | null;

export interface BuildManifestOptions {
  projectRoot: string;
  /** ISO timestamp (injected for determinism in tests). */
  generatedAt: string;
  extractSymbols?: SymbolExtractor;
}

// (candidate/id generation lives in candidates.ts so seeds + coverage agree)

function projectName(projectRoot: string): string {
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.name === "string" && pkg.name) return pkg.name;
    }
  } catch {
    /* ignore */
  }
  return basename(projectRoot) || "project";
}

export function buildManifest(opts: BuildManifestOptions): ScanManifest {
  const { projectRoot, generatedAt, extractSymbols } = opts;

  const { files: enumerated } = enumerateFiles(projectRoot);

  const languages = new Set<string>();
  const byLanguage: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  let symbolsExtractedFiles = 0;

  const langTagged = enumerated.map((f) => ({
    path: f.path,
    sizeLines: f.sizeLines,
    contentHash: f.contentHash,
    language: detectLanguage(f.path),
  }));

  const manifestFiles: ManifestFile[] = [];
  const layerIndex: Record<string, LayerIndexEntry> = {};

  for (const f of langTagged) {
    const language = f.language;
    const fileCategory = detectCategory(f.path);

    let symbols: FileSymbols = emptySymbols();
    let symbolsExtracted = false;
    if (extractSymbols && (fileCategory === "code" || fileCategory === "data" || fileCategory === "script")) {
      try {
        const content = readFileSync(join(projectRoot, f.path), "utf-8");
        const result = extractSymbols({ path: f.path, language, fileCategory }, content);
        if (result) {
          symbols = result;
          symbolsExtracted = true;
          symbolsExtractedFiles++;
        }
      } catch {
        /* degraded: keep empty symbols */
      }
    }

    const rebuildLayer: RebuildLayer = classifyRebuildLayer(f.path, {
      language,
      fileCategory,
      hasTableDefinitions: symbols.definitions.some((d) => d.kind === "table" || d.kind === "entity"),
      hasEndpoints: symbols.endpoints.length > 0,
    });

    manifestFiles.push({
      path: f.path,
      language,
      fileCategory,
      sizeLines: f.sizeLines,
      contentHash: f.contentHash,
      rebuildLayer,
      symbolsExtracted,
      symbols,
    });

    languages.add(language);
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    byCategory[fileCategory] = (byCategory[fileCategory] ?? 0) + 1;
    byLayer[rebuildLayer] = (byLayer[rebuildLayer] ?? 0) + 1;

    const mFile = manifestFiles[manifestFiles.length - 1];
    const entry = (layerIndex[rebuildLayer] ??= { files: [], symbolIds: [] });
    entry.files.push(f.path);
    entry.symbolIds.push(...fileCandidates(mFile).map((c) => c.id));
  }

  const importMap = buildImportMap(
    projectRoot,
    langTagged.map((f) => ({ path: f.path, language: f.language })),
  );

  return {
    version: MANIFEST_VERSION,
    generatedAt,
    gitCommitHash: getCommitHash(projectRoot),
    repository: getRepositoryInfo(projectRoot),
    project: {
      name: projectName(projectRoot),
      languages: [...languages].sort(),
      estimatedComplexity: estimateComplexity(manifestFiles.length),
    },
    files: manifestFiles,
    importMap,
    layerIndex,
    stats: {
      totalFiles: manifestFiles.length,
      byLanguage,
      byCategory,
      byLayer,
      symbolsExtractedFiles,
    },
  };
}
