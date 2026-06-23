/**
 * Filter / search / view state <-> URL query string.
 *
 * Only NON-default state is written, so a clean view yields a clean URL. Reading
 * happens once after the graph loads (layer defaults depend on the graph); after
 * that, every state change rewrites the query via history.replaceState so the URL
 * is shareable and survives reloads.
 */

import type { Filters, ViewMode } from "./store";
import {
  ALL_COVERAGE,
  ALL_NODE_TYPES,
  ALL_PRIORITIES,
  ALL_REBUILD_STATUS,
} from "./types";
import type { RebuildGraph } from "./types";

const EMPTY = "-"; // sentinel: facet explicitly cleared (none selected)

function sameMembers(set: Set<string>, full: string[]): boolean {
  if (set.size !== full.length) return false;
  return full.every((v) => set.has(v));
}

/** Encode a "default = all" facet: null when full, "-" when empty, else members. */
function encAll(set: Set<string>, full: string[]): string | null {
  if (sameMembers(set, full)) return null;
  if (set.size === 0) return EMPTY;
  return [...set].sort().join(",");
}

/** Decode a "default = all" facet. */
function decAll<T extends string>(param: string | null, full: readonly T[]): Set<T> {
  if (param == null) return new Set(full);
  if (param === EMPTY) return new Set();
  return new Set(param.split(",").filter(Boolean) as T[]);
}

export interface UrlState {
  filters: Partial<Filters>;
  searchQuery?: string;
  viewMode?: ViewMode;
  selectedDocPath?: string;
}

/** Serialize current state to a query string (without the leading "?"). */
export function encodeState(
  filters: Filters,
  searchQuery: string,
  viewMode: ViewMode,
  graph: RebuildGraph,
  selectedDocPath?: string | null,
): string {
  const p = new URLSearchParams();
  const layerIds = graph.layers.map((l) => l.id);
  const prioFull = [...ALL_PRIORITIES, "none"];

  const put = (key: string, val: string | null) => {
    if (val != null) p.set(key, val);
  };

  put("layers", encAll(filters.layers as Set<string>, layerIds));
  put("types", encAll(filters.nodeTypes as Set<string>, ALL_NODE_TYPES));
  put("cov", encAll(filters.coverage as Set<string>, ALL_COVERAGE));
  put("prio", encAll(filters.priorities as Set<string>, prioFull));
  put("status", encAll(filters.rebuildStatus as Set<string>, ALL_REBUILD_STATUS));
  // contractKinds default is EMPTY (no constraint) → only emit when set.
  if (filters.contractKinds.size > 0) {
    p.set("contracts", [...filters.contractKinds].sort().join(","));
  }
  if (searchQuery.trim()) p.set("q", searchQuery.trim());
  if (viewMode !== "graph") p.set("view", viewMode);
  // Only meaningful in the docs view; keeps the open doc shareable.
  if (viewMode === "docs" && selectedDocPath) p.set("doc", selectedDocPath);

  return p.toString();
}

/** Parse a query string into a partial state to apply onto the store. */
export function decodeState(search: string, graph: RebuildGraph): UrlState {
  const p = new URLSearchParams(search);
  const layerIds = graph.layers.map((l) => l.id);
  const prioFull = [...ALL_PRIORITIES, "none"];

  const filters: Partial<Filters> = {
    layers: decAll(p.get("layers"), layerIds),
    nodeTypes: decAll(p.get("types"), ALL_NODE_TYPES),
    coverage: decAll(p.get("cov"), ALL_COVERAGE),
    priorities: decAll(p.get("prio"), prioFull) as Filters["priorities"],
    rebuildStatus: decAll(p.get("status"), ALL_REBUILD_STATUS),
    contractKinds: new Set(
      (p.get("contracts")?.split(",").filter(Boolean) ?? []) as never[],
    ) as Filters["contractKinds"],
  };

  const out: UrlState = { filters };
  const q = p.get("q");
  if (q) out.searchQuery = q;
  const view = p.get("view");
  if (
    view === "overview" ||
    view === "priorities" ||
    view === "contracts" ||
    view === "docs"
  ) {
    out.viewMode = view;
  }
  const doc = p.get("doc");
  if (doc) out.selectedDocPath = doc;
  return out;
}

/** Replace the URL query without adding a history entry. */
export function writeUrl(query: string): void {
  const url = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState(null, "", url);
}
