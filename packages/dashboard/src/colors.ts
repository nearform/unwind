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

/** A representative color per rebuild layer (theme-aware CSS var). */
export function layerColor(layer: string): string {
  switch (layer) {
    case "database":
      return "var(--color-node-table)";
    case "domain":
      return "var(--color-node-class)";
    case "service":
      return "var(--color-node-function)";
    case "api":
      return "var(--color-node-endpoint)";
    case "messaging":
      return "var(--color-node-contract)";
    case "frontend":
      return "var(--color-node-file)";
    case "tests":
      return "var(--color-prio-should)";
    case "infrastructure":
      return "var(--color-text-secondary)";
    default:
      return "var(--color-text-muted)";
  }
}

/** Short header-chip label per rebuild layer. */
export function layerShortLabel(layer: string): string {
  switch (layer) {
    case "database":
      return "DB";
    case "domain":
      return "Domain";
    case "service":
      return "Service";
    case "api":
      return "API";
    case "messaging":
      return "Msg";
    case "frontend":
      return "Frontend";
    case "tests":
      return "Tests";
    case "infrastructure":
      return "Infra";
    case "unassigned":
      return "Other";
    default:
      return layer;
  }
}
