/**
 * Deterministic per-file language detection.
 *
 * Ported natively (MIT) from the canonical extension/filename tables used by
 * Understand-Anything's scan-project.mjs. Language ids are stable strings that
 * downstream consumers (the structural extractor registry, the rebuild-layer
 * map) key off, so keep them lowercase and additive.
 */

import { basename, extname } from "node:path";

/** Extension -> language id. Lowercase keys; lookup is `.ext.toLowerCase()`. */
const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = Object.freeze({
  // TypeScript / JavaScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  // Python
  ".py": "python",
  ".pyi": "python",
  // Go / Rust / Java / Kotlin / C# / Swift / Lua
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".swift": "swift",
  ".lua": "lua",
  // Ruby / PHP
  ".rb": "ruby",
  ".rake": "ruby",
  ".php": "php",
  // C / C++
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  // Vue / Svelte
  ".vue": "vue",
  ".svelte": "svelte",
  // Shell / Batch / PowerShell
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  ".bat": "batch",
  ".cmd": "batch",
  // Markup / docs
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".md": "markdown",
  ".mdx": "markdown",
  ".rst": "markdown",
  // Config / data
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".toml": "toml",
  ".xml": "xml",
  ".xsl": "xml",
  ".xsd": "xml",
  ".plist": "xml",
  ".cfg": "config",
  ".ini": "config",
  ".env": "config",
  // Data / schema
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".prisma": "prisma",
  ".csv": "csv",
  ".tsv": "csv",
  // Infra
  ".tf": "terraform",
  ".tfvars": "terraform",
  // Build files
  ".gradle": "gradle",
  ".csproj": "csproj",
  ".sln": "sln",
  ".properties": "properties",
  ".mod": "mod",
  ".sum": "sum",
});

/** Filename (no extension) -> language id. Compared case-sensitively. */
const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = Object.freeze({
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  GNUmakefile: "makefile",
  makefile: "makefile",
  Jenkinsfile: "jenkinsfile",
  Procfile: "procfile",
  Vagrantfile: "vagrantfile",
});

/**
 * Extract the canonical dotfile "extension" from a basename, or null.
 * `.env` -> `.env`, `.env.local` -> `.env`, `package.json` -> null.
 */
function dotfileKey(base: string): string | null {
  if (!base.startsWith(".")) return null;
  const m = base.match(/^(\.[a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Detect the language of a file by its path. Never returns null — falls back
 * to the lowercased extension (without dot) or 'unknown'.
 */
export function detectLanguage(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return "dockerfile";

  const dotKey = dotfileKey(base);
  if (dotKey && LANGUAGE_BY_EXT[dotKey]) return LANGUAGE_BY_EXT[dotKey];

  if (ext) {
    const byExt = LANGUAGE_BY_EXT[ext];
    if (byExt) return byExt;
    return ext.slice(1);
  }

  const byFilename = LANGUAGE_BY_FILENAME[base];
  if (byFilename) return byFilename;

  return "unknown";
}

export { dotfileKey };
