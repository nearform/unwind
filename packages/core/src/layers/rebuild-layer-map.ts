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
  /** Whether the file declares a program entrypoint (`main`/`Main`) — a bootstrap. */
  hasEntrypoint?: boolean;
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

  // Category-decisive non-code: assets/docs/scripts/infra/data have a fixed home
  // regardless of where they sit. (`config` is deliberately NOT here — a config
  // file in a meaningful directory, e.g. a migration snapshot under `db/`, should
  // keep that context via the directory patterns below.)
  switch (evidence.fileCategory) {
    case "data":
      return "database";
    case "infra":
    case "script":
    case "docs":
      return "infrastructure";
    case "markup":
      return "frontend";
  }

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

  // 4b. Config that no directory/filename rule located -> infrastructure
  // (project/build config), not unassigned.
  if (evidence.fileCategory === "config") return "infrastructure";

  // 4c. Program entrypoint (`public static void main`, Spring `@SpringBootApplication`
  // bootstrap, Go/Rust `main`) — infrastructure, not unassigned.
  if (evidence.hasEntrypoint) return "infrastructure";

  // 5. Unassigned — only genuinely ambiguous *code* reaches here.
  return "unassigned";
}

/**
 * Single source of truth for layer -> documentation folder(s) under
 * `docs/unwind/layers/`. A layer maps to a LIST because `tests` fans out to
 * three specialist folders (unit/integration/e2e). Both the analysis dispatch
 * (which folder a specialist writes to) and `verify-coverage` (which folders it
 * reads back) resolve through this map so the two can never drift — the root
 * cause of the "false 0% coverage" folder-name mismatch.
 */
export const LAYER_DOC_DIRS: Record<RebuildLayer, readonly string[]> = {
  database: ["database"],
  domain: ["domain-model"],
  service: ["service-layer"],
  api: ["api"],
  messaging: ["messaging"],
  frontend: ["frontend"],
  tests: ["unit-tests", "integration-tests", "e2e-tests"],
  infrastructure: ["infrastructure"],
  unassigned: ["unassigned"],
};

/** All documentation folder(s) for a layer (falls back to the layer name). */
export function docDirsForLayer(layer: string): readonly string[] {
  return LAYER_DOC_DIRS[layer as RebuildLayer] ?? [layer];
}

/**
 * The canonical (primary) documentation folder for a layer — what a single
 * specialist writes to and where `verify-coverage` drops a `gaps.md`. For
 * `tests` this is `unit-tests`; the other test folders are still read back.
 */
export function primaryDocDir(layer: string): string {
  return docDirsForLayer(layer)[0] ?? layer;
}

/** The three test specialist doc folders a `tests`-layer file can belong to. */
export type TestDocDir = "unit-tests" | "integration-tests" | "e2e-tests";

const E2E_TEST_RE =
  /(^|[/._-])(e2e|cypress|playwright|webdriver|selenium|puppeteer)([/._-]|$)/i;
// Integration markers: a directory segment (`it/`, `integration/`), the Java
// failsafe suffix (`*IT.java`, `*IntegrationTest.java` — case-sensitive so
// `audit.ts` isn't caught), or an `integration`/`contract` token in the name.
const INTEGRATION_DIR_RE = /(^|\/)(it|integration|integration[-_]tests?)(\/|$)/i;
const INTEGRATION_FILE_RE = /(IT|IntegrationTest)\.[a-z0-9]+$/;
const INTEGRATION_TOKEN_RE = /(^|[/._-])(integration|contract)([/._-]|$)/i;

/**
 * Sub-classify a test file into its specialist doc folder. The scanner assigns a
 * single `tests` layer; this splits that layer's candidates across the three
 * test specialists so each is seeded with only its own checklist. Coverage still
 * verifies the unified `tests` layer (the union of the three folders), so a
 * misclassification here only shifts which specialist documents an item — it can
 * never drop one. Defaults to `unit-tests`.
 */
export function classifyTestKind(filePath: string): TestDocDir {
  const posix = filePath.split(sep).join("/");
  const base = basename(posix);
  if (E2E_TEST_RE.test(posix)) return "e2e-tests";
  if (
    INTEGRATION_DIR_RE.test(posix) ||
    INTEGRATION_FILE_RE.test(base) ||
    INTEGRATION_TOKEN_RE.test(base)
  ) {
    return "integration-tests";
  }
  return "unit-tests";
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
