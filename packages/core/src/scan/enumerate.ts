/**
 * Deterministic file enumeration.
 *
 * `git ls-files` is preferred (respects .gitignore, stable order, fast). When
 * the target is not a git repo, a recursive walker is the fallback with a
 * built-in default-exclusion list. Zero runtime dependencies — we deliberately
 * avoid the `ignore` package so the core builds and runs with no install.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Directories never worth descending into. Applied by the walker AND as a
 * post-filter on git output so vendored/build output never reaches the manifest
 * even when committed.
 */
const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  "target",
  "vendor",
  "coverage",
  ".cache",
  ".idea",
  ".vscode",
  "docs/unwind",
]);

/** True when any path segment is an excluded directory. */
function isExcludedPath(posixPath: string): boolean {
  if (posixPath.startsWith("docs/unwind/")) return true;
  const segments = posixPath.split("/");
  // Drop the file name; only directory segments matter.
  for (let i = 0; i < segments.length - 1; i++) {
    if (DEFAULT_EXCLUDE_DIRS.has(segments[i])) return true;
  }
  return false;
}

function enumerateViaGit(projectRoot: string): string[] | null {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "-co", "--exclude-standard"],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.split("\0").filter(Boolean).map(toPosix);
}

function enumerateViaWalk(projectRoot: string): string[] {
  const out: string[] = [];

  function walk(absDir: string): void {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (DEFAULT_EXCLUDE_DIRS.has(ent.name)) continue;
        walk(join(absDir, ent.name));
      } else if (ent.isFile()) {
        const rel = toPosix(relative(projectRoot, join(absDir, ent.name)));
        if (rel) out.push(rel);
      }
    }
  }

  walk(projectRoot);
  return out;
}

export interface EnumeratedFile {
  /** Project-relative POSIX path. */
  path: string;
  /** Newline count (`wc -l` semantics). */
  sizeLines: number;
}

/**
 * Enumerate candidate source files under `projectRoot`, sorted by path.
 * Applies default-directory exclusions and per-file line counting. Files that
 * cannot be stat'd or read are silently dropped (per-file resilience).
 */
export function enumerateFiles(projectRoot: string): {
  files: EnumeratedFile[];
  usedGit: boolean;
} {
  const fromGit = enumerateViaGit(projectRoot);
  const usedGit = fromGit !== null;
  const candidates = (fromGit ?? enumerateViaWalk(projectRoot)).filter(
    (p) => !isExcludedPath(p),
  );

  const files: EnumeratedFile[] = [];
  for (const rel of candidates) {
    const absPath = join(projectRoot, rel);
    let sizeLines: number;
    try {
      const st = statSync(absPath);
      if (!st.isFile()) continue;
      sizeLines = countLines(absPath);
    } catch {
      continue;
    }
    files.push({ path: rel, sizeLines });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, usedGit };
}

function countLines(absPath: string): number {
  const buf = readFileSync(absPath);
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++;
  }
  return count;
}
