/**
 * Shared @unwind/core loader for the bundled scripts. Two-step resolution
 * (workspace package -> built dist) with a clear error so callers can fall back
 * to legacy pure-LLM behavior. pathToFileURL is required on Windows.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const require = createRequire(resolve(pluginRoot, "package.json"));

export { pluginRoot };

export async function loadCore() {
  try {
    return await import(pathToFileURL(require.resolve("@unwind/core")).href);
  } catch {
    try {
      return await import(
        pathToFileURL(resolve(pluginRoot, "packages/core/dist/index.js")).href
      );
    } catch (err) {
      process.stderr.write(
        "@unwind/core is not built. Run `pnpm install && pnpm build` in the " +
          `plugin root, or fall back to legacy discovery.\nUnderlying error: ${err.message}\n`,
      );
      process.exit(2);
    }
  }
}

/** Map a rebuild layer to its docs/unwind/layers/<dir> documentation folder. */
export const LAYER_DOC_DIR = {
  database: "database",
  domain: "domain-model",
  service: "service-layer",
  api: "api",
  messaging: "messaging",
  frontend: "frontend",
  tests: "tests",
  infrastructure: "infrastructure",
  unassigned: "unassigned",
};
