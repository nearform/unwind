/**
 * Deterministic per-file category detection.
 *
 * Categories: code | config | docs | infra | data | script | markup
 * Ported natively (MIT) from Understand-Anything's scan-project.mjs priority
 * rules. The category feeds the rebuild-layer map (e.g. `data` SQL files lean
 * database) and the dashboard's grouping.
 */

import { basename, extname, sep } from "node:path";
import { dotfileKey } from "./language-table.js";

export type FileCategory =
  | "code"
  | "config"
  | "docs"
  | "infra"
  | "data"
  | "script"
  | "markup";

const CATEGORY_BY_EXT: Readonly<Record<string, FileCategory>> = Object.freeze({
  // docs
  ".md": "docs",
  ".mdx": "docs",
  ".rst": "docs",
  ".txt": "docs",
  ".text": "docs",
  // config
  ".yaml": "config",
  ".yml": "config",
  ".json": "config",
  ".jsonc": "config",
  ".toml": "config",
  ".xml": "config",
  ".xsl": "config",
  ".xsd": "config",
  ".plist": "config",
  ".cfg": "config",
  ".ini": "config",
  ".env": "config",
  ".properties": "config",
  ".csproj": "config",
  ".sln": "config",
  ".mod": "config",
  ".sum": "config",
  ".gradle": "config",
  // infra
  ".tf": "infra",
  ".tfvars": "infra",
  // data
  ".sql": "data",
  ".graphql": "data",
  ".gql": "data",
  ".proto": "data",
  ".prisma": "data",
  ".csv": "data",
  ".tsv": "data",
  // script
  ".sh": "script",
  ".bash": "script",
  ".zsh": "script",
  ".ps1": "script",
  ".psm1": "script",
  ".psd1": "script",
  ".bat": "script",
  ".cmd": "script",
  // markup
  ".html": "markup",
  ".htm": "markup",
  ".css": "markup",
  ".scss": "markup",
  ".sass": "markup",
  ".less": "markup",
});

const INFRA_FILENAMES = new Set([
  "Dockerfile",
  ".dockerignore",
  "Makefile",
  "GNUmakefile",
  "makefile",
  "Jenkinsfile",
  "Procfile",
  "Vagrantfile",
  ".gitlab-ci.yml",
]);

/** Detect the category for a file. Most-specific rule wins; fallback is `code`. */
export function detectCategory(filePath: string): FileCategory {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const posix = filePath.split(sep).join("/");

  // LICENSE exception — never classify as docs.
  if (base === "LICENSE") return "code";

  // Infra by filename.
  if (INFRA_FILENAMES.has(base)) return "infra";
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return "infra";
  if (base.startsWith("docker-compose.")) return "infra";
  if (base === "compose.yml" || base === "compose.yaml") return "infra";

  // Infra by path.
  if (posix.startsWith(".github/workflows/")) return "infra";
  if (posix.startsWith(".circleci/")) return "infra";
  if (/(^|\/)(k8s|kubernetes)\//.test(posix)) return "infra";
  if (/\.k8s\.(ya?ml)$/i.test(base)) return "infra";

  // Extension-based lookup.
  if (ext) {
    const byExt = CATEGORY_BY_EXT[ext];
    if (byExt) return byExt;
  }

  // Dotfile-style configs (.env, .env.local).
  const dotKey = dotfileKey(base);
  if (dotKey) {
    const byDot = CATEGORY_BY_EXT[dotKey];
    if (byDot) return byDot;
  }

  return "code";
}

/** Map a total file count to a complexity tier. */
export function estimateComplexity(
  totalFiles: number,
): "small" | "moderate" | "large" | "very-large" {
  if (totalFiles <= 30) return "small";
  if (totalFiles <= 150) return "moderate";
  if (totalFiles <= 500) return "large";
  return "very-large";
}
