/**
 * Internal import resolution — resolves the AST-extracted import edges (produced
 * deterministically by the tree-sitter extractors) to internal file paths.
 *
 * This consumes `file.symbols.imports` rather than re-parsing source: the
 * extractors already walk the AST for every supported language, so there is no
 * separate (and previously JS/TS-only, regex-based) extraction step here. The
 * job left is purely *resolution* — mapping a language-specific module specifier
 * to a known internal file:
 *   - JS/TS    relative specifier (`./x`) -> path, with NodeNext `.js`->`.ts`
 *   - Java     fully-qualified type (`com.app.model.User`) -> the file declaring it
 *   - Python   dotted module (`app.models`) / relative (`.models`) -> path
 * External packages and specifiers that resolve to no known file are dropped
 * (they can never produce an internal edge). Languages without a resolver here
 * (Rust, C#) still get file-grain coverage; their edges can be added later
 * without changing the importMap contract (file -> internal file paths).
 */

import { dirname, join, posix as posixPath } from "node:path";
import type { FileSymbols } from "../manifest/manifest-schema.js";

/** Minimal file shape the resolver needs: path, language, and its AST imports. */
export interface ImportMapFile {
  path: string;
  language: string;
  symbols: Pick<FileSymbols, "imports">;
}

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

const JAVA_SOURCE_ROOTS = [
  "src/main/java/",
  "src/test/java/",
  "src/main/kotlin/",
  "src/test/kotlin/",
];

/** Fully-qualified type name a `.java`/`.kt` file declares (by path convention). */
function javaFqnForPath(path: string): string | null {
  const noExt = path.replace(/\.(java|kt)$/, "");
  if (noExt === path) return null;
  for (const root of JAVA_SOURCE_ROOTS) {
    const i = noExt.indexOf(root);
    if (i >= 0) return noExt.slice(i + root.length).split("/").join(".");
  }
  const j = noExt.indexOf("/java/");
  if (j >= 0) return noExt.slice(j + "/java/".length).split("/").join(".");
  return noExt.split("/").join(".");
}

interface JavaIndex {
  /** Fully-qualified type name -> file path. */
  byType: Map<string, string>;
  /** Package name -> file paths declared in it (for wildcard imports). */
  byPackage: Map<string, string[]>;
}

function buildJavaIndex(files: ImportMapFile[]): JavaIndex {
  const byType = new Map<string, string>();
  const byPackage = new Map<string, string[]>();
  for (const f of files) {
    if (f.language !== "java") continue;
    const fqn = javaFqnForPath(f.path);
    if (!fqn) continue;
    byType.set(fqn, f.path);
    const dot = fqn.lastIndexOf(".");
    if (dot > 0) {
      const pkg = fqn.slice(0, dot);
      const bucket = byPackage.get(pkg);
      if (bucket) bucket.push(f.path);
      else byPackage.set(pkg, [f.path]);
    }
  }
  return { byType, byPackage };
}

function resolveJava(source: string, index: JavaIndex): string[] {
  const direct = index.byType.get(source);
  if (direct) return [direct];
  // `import com.app.model.*` arrives as the package (specifiers === ["*"]).
  const pkg = index.byPackage.get(source);
  return pkg ? [...pkg] : [];
}

/** Dotted module name a `.py` file provides (e.g. `app/models.py` -> `app.models`). */
function pyModuleForPath(path: string): string | null {
  let p = path.replace(/\.py$/, "");
  if (p === path) return null;
  p = p.replace(/^src\//, "");
  if (p.endsWith("/__init__")) p = p.slice(0, -"/__init__".length);
  return p.split("/").join(".");
}

function buildPythonIndex(files: ImportMapFile[]): Map<string, string> {
  const byModule = new Map<string, string>();
  for (const f of files) {
    if (f.language !== "python") continue;
    const mod = pyModuleForPath(f.path);
    if (mod) byModule.set(mod, f.path);
  }
  return byModule;
}

function resolvePython(
  fromFile: string,
  source: string,
  byModule: Map<string, string>,
): string[] {
  // Relative import: leading dots count levels up from the current package.
  if (source.startsWith(".")) {
    const dots = source.length - source.replace(/^\.+/, "").length;
    const tail = source.slice(dots).split(".").filter(Boolean);
    let dir = dirname(fromFile);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    const base = dir === "." ? "" : `${dir}/`;
    const rel = `${base}${tail.join("/")}`;
    const mod = pyModuleForPath(`${rel}.py`);
    const hit = mod ? byModule.get(mod) : undefined;
    return hit ? [hit] : [];
  }
  const direct = byModule.get(source);
  return direct ? [direct] : [];
}

interface Resolvers {
  fileSet: Set<string>;
  java: JavaIndex;
  python: Map<string, string>;
}

function resolveOne(file: ImportMapFile, source: string, r: Resolvers): string[] {
  switch (file.language) {
    case "typescript":
    case "javascript":
      // Only relative specifiers can be internal; bare specifiers are packages.
      if (!source.startsWith(".")) return [];
      return [resolveRelative(file.path, source, r.fileSet)].filter(
        (x): x is string => x !== null,
      );
    case "java":
      return resolveJava(source, r.java);
    case "python":
      return resolvePython(file.path, source, r.python);
    default:
      // Rust / C# / others: file-grain coverage only (no resolver yet).
      return [];
  }
}

/**
 * Build the internal import map from the manifest files' AST-extracted imports.
 * `files` carry their resolved language and `symbols.imports`; the returned map
 * is file path -> sorted internal file paths it imports.
 */
export function buildImportMap(files: ImportMapFile[]): Record<string, string[]> {
  const resolvers: Resolvers = {
    fileSet: new Set(files.map((f) => f.path)),
    java: buildJavaIndex(files),
    python: buildPythonIndex(files),
  };
  const importMap: Record<string, string[]> = {};

  for (const file of files) {
    const resolved = new Set<string>();
    for (const imp of file.symbols.imports ?? []) {
      for (const target of resolveOne(file, imp.source, resolvers)) {
        if (target !== file.path) resolved.add(target);
      }
    }
    if (resolved.size > 0) importMap[file.path] = [...resolved].sort();
  }

  return importMap;
}
