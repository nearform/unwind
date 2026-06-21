import type { CoverageState, NodeType, RebuildPriority, RebuildStatus } from "./types";

/** Graph node-type color (CSS var defined in index.css). */
export function nodeTypeColor(t: NodeType): string {
  switch (t) {
    case "file":
      return "var(--color-node-file)";
    case "function":
      return "var(--color-node-function)";
    case "class":
      return "var(--color-node-class)";
    case "table":
      return "var(--color-node-table)";
    case "endpoint":
      return "var(--color-node-endpoint)";
    case "contract":
      return "var(--color-node-contract)";
  }
}

export function coverageColor(c: CoverageState): string {
  switch (c) {
    case "scanned":
      return "var(--color-cov-scanned)";
    case "documented":
      return "var(--color-cov-documented)";
    case "verified":
      return "var(--color-cov-verified)";
    case "excluded":
      return "var(--color-cov-excluded)";
    case "stale":
      return "var(--color-cov-stale)";
  }
}

export function priorityColor(p: RebuildPriority): string {
  switch (p) {
    case "MUST":
      return "var(--color-prio-must)";
    case "SHOULD":
      return "var(--color-prio-should)";
    case "DON'T":
      return "var(--color-prio-dont)";
    default:
      return "var(--color-text-muted)";
  }
}

export function statusLabel(s: RebuildStatus): string {
  return s.replace(/-/g, " ");
}
