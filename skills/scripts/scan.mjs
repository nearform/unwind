#!/usr/bin/env node
/**
 * scan.mjs
 *
 * Deterministic ground-truth scan for Unwind. Produces scan-manifest.json — the
 * single source of structural truth that seeds layer specialists and powers the
 * coverage diff (see docs/unwind plan). Replaces the LLM's "go find all the
 * tables" guesswork with a checkable file/symbol inventory.
 *
 * Usage:
 *   node scan.mjs <projectRoot> [outputPath]
 *
 * Default outputPath: <projectRoot>/docs/unwind/.cache/scan-manifest.json
 *
 * Graceful degradation: if @unwind/core cannot be loaded/built, this exits
 * non-zero with a clear message so the calling skill can fall back to the
 * legacy pure-LLM discovery flow. It never corrupts existing docs.
 */

import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/scripts/ -> plugin root is two dirs up.
const pluginRoot = resolve(__dirname, "../..");
const require = createRequire(resolve(pluginRoot, "package.json"));

// ---------------------------------------------------------------------------
// Resolve @unwind/core. Two-step: workspace-linked package first, then the
// built dist for installed/cache layouts. pathToFileURL() is required on
// Windows (raw "C:\..." paths throw ERR_UNSUPPORTED_ESM_URL_SCHEME).
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve("@unwind/core")).href);
} catch {
  try {
    core = await import(
      pathToFileURL(resolve(pluginRoot, "packages/core/dist/index.js")).href
    );
  } catch (err) {
    process.stderr.write(
      "scan.mjs: @unwind/core is not built. Run `pnpm install && pnpm build` " +
        "in the plugin root, or fall back to legacy discovery.\n" +
        `Underlying error: ${err.message}\n`,
    );
    process.exit(2);
  }
}

const { buildManifest, validateManifest, TreeSitterPlugin, buildFingerprints } = core;

async function main() {
  const [, , projectRootArg, outputArg] = process.argv;
  if (!projectRootArg) {
    process.stderr.write("Usage: node scan.mjs <projectRoot> [outputPath]\n");
    process.exit(1);
  }
  const projectRoot = resolve(projectRootArg);
  if (!existsSync(projectRoot)) {
    process.stderr.write(`scan.mjs: projectRoot does not exist: ${projectRoot}\n`);
    process.exit(1);
  }

  const outputPath = outputArg
    ? resolve(outputArg)
    : join(projectRoot, "docs/unwind/.cache/scan-manifest.json");

  // Initialize tree-sitter once (async), then expose a synchronous extractor
  // to buildManifest. If grammars fail to load, extraction degrades to empty
  // symbols (file-grain coverage) without aborting the scan.
  let extractSymbols;
  try {
    const plugin = new TreeSitterPlugin();
    await plugin.init();
    extractSymbols = (file, content) => {
      try {
        return plugin.analyze(file.path, content);
      } catch {
        return null;
      }
    };
  } catch (err) {
    process.stderr.write(
      `scan: tree-sitter unavailable (${err.message}); continuing with file-grain coverage\n`,
    );
  }

  const manifest = buildManifest({
    projectRoot,
    generatedAt: new Date().toISOString(),
    extractSymbols,
  });

  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    process.stderr.write(
      `scan.mjs: manifest failed validation:\n  - ${problems.join("\n  - ")}\n`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");
  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  // Write the incremental baseline (fingerprints + commit) next to the manifest.
  // detect-changes.mjs diffs a fresh scan against this to find what moved.
  const metaPath = join(dirname(outputPath), "meta.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        version: manifest.version,
        generatedAt: manifest.generatedAt,
        gitCommitHash: manifest.gitCommitHash,
        analyzedFiles: manifest.stats.totalFiles,
        fingerprints: buildFingerprints(manifest),
      },
      null,
      2,
    ),
    "utf-8",
  );

  const s = manifest.stats;
  const layerSummary = Object.entries(s.byLayer)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  process.stderr.write(
    `scan: totalFiles=${s.totalFiles} symbolsExtractedFiles=${s.symbolsExtractedFiles} ` +
      `complexity=${manifest.project.estimatedComplexity}\n` +
      `scan: layers ${layerSummary}\n` +
      `scan: wrote ${outputPath}\n`,
  );
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`scan.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
