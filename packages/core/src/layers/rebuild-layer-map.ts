/**
 * Rebuild-layer classification.
 *
 * Unwind's analysis is organized around fixed, dependency-ordered REBUILD
 * layers (not Understand-Anything's pedagogical layers). Every file is assigned
 * to exactly one layer so the layer specialists can be *seeded* with a concrete
 * candidate list — turning "document all 42 tables" from an exhortation into a
 * checklist (see analysis-principles.md).
 *
 * Classification priority:
 *   1. Test evidence (path/filename) — tests win over everything.
 *   2. Directory patterns (mirrors skills/start/SKILL.md layer-detection table).
 *   3. Filename conventions (*Repository, *Service, *Controller, ...).
 *   4. Symbol/category evidence (table definitions -> database, endpoints -> api).
 *   5. Fallback -> `unassigned` (surfaced to the LLM for adjudication, never
 *      silently dropped).
 */

import { basename, sep } from "node:path";
import type { FileCategory } from "../scan/category-table.js";

export type RebuildLayer =
  | "database"
  | "domain"
  | "service"
  | "api"
  | "messaging"
  | "frontend"
  | "tests"
  | "infrastructure"
  | "unassigned";

/** Minimal structural signal used to disambiguate layer when paths are unclear. */
export interface LayerEvidence {
  language: string;
  fileCategory: FileCategory;
  /** Whether structural extraction found table/entity definitions. */
  hasTableDefinitions?: boolean;
  /** Whether structural extraction found HTTP endpoints. */
  hasEndpoints?: boolean;
  /** Whether structural extraction found messaging publish/subscribe sites. */
  hasMessaging?: boolean;
}

/** Directory-segment -> layer. A segment match anywhere in the path applies. */
const DIR_LAYER: ReadonlyArray<[RegExp, RebuildLayer]> = [
  [/(^|\/)(repository|repositories|dao|daos|persistence|datastore)(\/|$)/i, "database"],
  [/(^|\/)(migrations?|schema|schemas|db|database)(\/|$)/i, "database"],
  [/(^|\/)(domain|entity|entities|model|models)(\/|$)/i, "domain"],
  [/(^|\/)(service|services|usecase|usecases|application|biz|business)(\/|$)/i, "service"],
  [/(^|\/)(controller|controllers|api|rest|routes?|graphql|resolvers?|handlers?)(\/|$)/i, "api"],
  [/(^|\/)(messaging|events?|queue|queues|kafka|rabbitmq|sqs|pubsub|consumers?|producers?|listeners?)(\/|$)/i, "messaging"],
  [/(^|\/)(components?|pages?|views?|ui|screens?|widgets?|app\/.*\.(tsx|jsx))(\/|$)/i, "frontend"],
  [/(^|\/)(infra|infrastructure|deploy|deployment|ops|terraform|k8s|kubernetes|helm)(\/|$)/i, "infrastructure"],
];

/** Filename suffix conventions -> layer. Checked on the basename. */
const FILENAME_LAYER: ReadonlyArray<[RegExp, RebuildLayer]> = [
  [/(repository|repo|dao)\.[a-z]+$/i, "database"],
  [/(entity|model)\.[a-z]+$/i, "domain"],
  [/service\.[a-z]+$/i, "service"],
  [/(controller|resolver|router?)\.[a-z]+$/i, "api"],
  [/(consumer|producer|listener|handler|subscriber)\.[a-z]+$/i, "messaging"],
  [/\.(component|page|view)\.[a-z]+$/i, "frontend"],
];

/** Filename conventions that mark a test regardless of directory. */
const TEST_FILENAME_PATTERNS: ReadonlyArray<RegExp> = [
  /\.(test|spec|e2e)\.[a-z]+$/i,
  /_test\.[a-z]+$/i,
  /^test_[^/]+$/i,
];

/** Directory conventions that mark a test, but only for code/script files. */
const TEST_DIR_PATTERN =
  /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)(\/|$)/i;

function isTestPath(posix: string, category: FileCategory): boolean {
  const base = basename(posix);
  if (TEST_FILENAME_PATTERNS.some((re) => re.test(base))) return true;
  // A `specs/` directory may hold design docs; only count real source there.
  if (TEST_DIR_PATTERN.test(posix) && (category === "code" || category === "script")) {
    return true;
  }
  return false;
}

/** Frontend file extensions that are unambiguous regardless of directory. */
const FRONTEND_EXTS = /\.(tsx|jsx|vue|svelte)$/i;

/**
 * Classify a single file into a rebuild layer. `evidence` is optional; when
 * structural extraction has run, passing `hasTableDefinitions`/`hasEndpoints`/
 * `hasMessaging` sharpens otherwise-ambiguous assignments.
 */
export function classifyRebuildLayer(
  filePath: string,
  evidence: LayerEvidence,
): RebuildLayer {
  const posix = filePath.split(sep).join("/");
  const base = basename(posix);

  // 1. Tests win.
  if (isTestPath(posix, evidence.fileCategory)) return "tests";

  // Non-code categories route by category before path heuristics.
  if (evidence.fileCategory === "infra") return "infrastructure";
  if (evidence.fileCategory === "data") return "database";

  // 2. Directory patterns.
  for (const [re, layer] of DIR_LAYER) {
    if (re.test(posix)) return layer;
  }

  // 3. Filename conventions.
  for (const [re, layer] of FILENAME_LAYER) {
    if (re.test(base)) return layer;
  }

  // 4. Symbol/category evidence.
  if (evidence.hasTableDefinitions) return "database";
  if (evidence.hasEndpoints) return "api";
  if (evidence.hasMessaging) return "messaging";
  if (FRONTEND_EXTS.test(base)) return "frontend";

  // 5. Unassigned — surfaced for LLM adjudication.
  return "unassigned";
}

/** Dependency order used to drive specialist dispatch downstream. */
export const REBUILD_LAYER_ORDER: readonly RebuildLayer[] = [
  "database",
  "domain",
  "service",
  "api",
  "messaging",
  "frontend",
  "tests",
  "infrastructure",
  "unassigned",
];
