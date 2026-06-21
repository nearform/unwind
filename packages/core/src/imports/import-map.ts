/**
 * Lightweight internal import resolution.
 *
 * Stage-A implementation: regex-based extraction of JS/TS import specifiers and
 * resolution of *relative* imports against the known file set. External packages
 * and non-relative imports are dropped (they can never produce internal edges).
 * Tree-sitter-backed extraction for more languages can replace this later
 * without changing the importMap contract (file -> internal file paths).
 */

import { readFileSync } from "node:fs";
import { join, dirname, posix as posixPath } from "node:path";

const IMPORT_RE =
  /(?:import\s[^'"]*?from\s*['"]([^'"]+)['"])|(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:export\s[^'"]*?from\s*['"]([^'"]+)['"])/g;

const JS_TS_LANGS = new Set(["typescript", "javascript"]);

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/**
 * NodeNext/ESM-TypeScript writes `import './x.js'` while the file on disk is
 * `./x.ts`. Generate the base candidates a specifier could resolve to,
 * including the .js -> .ts/.tsx rewrite.
 */
function candidateBases(joined: string): string[] {
  const bases = [joined];
  const m = joined.match(/^(.*)\.(js|jsx|mjs|cjs)$/);
  if (m) bases.push(`${m[1]}.ts`, `${m[1]}.tsx`, `${m[1]}.mts`, `${m[1]}.cts`);
  return bases;
}

function resolveRelative(
  fromFile: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  const baseDir = dirname(fromFile);
  const joined = posixPath.normalize(join(baseDir, spec).split("\\").join("/"));
  for (const base of candidateBases(joined)) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Build the internal import map for the given files. `projectRoot` is used to
 * read file contents; `files` are project-relative POSIX paths with language.
 */
export function buildImportMap(
  projectRoot: string,
  files: { path: string; language: string }[],
): Record<string, string[]> {
  const fileSet = new Set(files.map((f) => f.path));
  const importMap: Record<string, string[]> = {};

  for (const file of files) {
    if (!JS_TS_LANGS.has(file.language)) continue;
    let content: string;
    try {
      content = readFileSync(join(projectRoot, file.path), "utf-8");
    } catch {
      continue;
    }
    const resolved = new Set<string>();
    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!spec || !spec.startsWith(".")) continue;
      const target = resolveRelative(file.path, spec, fileSet);
      if (target && target !== file.path) resolved.add(target);
    }
    if (resolved.size > 0) importMap[file.path] = [...resolved].sort();
  }

  return importMap;
}
