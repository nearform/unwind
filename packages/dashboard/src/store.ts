import { create } from "zustand";
import type {
  ContractKind,
  CoverageState,
  NodeType,
  RebuildGraph,
  RebuildNode,
  RebuildPriority,
  RebuildStatus,
} from "./types";
import { ALL_COVERAGE, ALL_NODE_TYPES, ALL_PRIORITIES, ALL_REBUILD_STATUS } from "./types";

export type ViewMode = "graph" | "overview" | "priorities" | "contracts";

export interface Filters {
  nodeTypes: Set<NodeType>;
  coverage: Set<CoverageState>;
  /** priority facet; "none" represents untagged (null) priority. */
  priorities: Set<Exclude<RebuildPriority, null> | "none">;
  rebuildStatus: Set<RebuildStatus>;
  contractKinds: Set<Exclude<ContractKind, null>>;
  /** empty = all layers visible. */
  layers: Set<string>;
}

function defaultFilters(): Filters {
  return {
    nodeTypes: new Set(ALL_NODE_TYPES),
    coverage: new Set(ALL_COVERAGE),
    priorities: new Set([...ALL_PRIORITIES, "none" as const]),
    rebuildStatus: new Set(ALL_REBUILD_STATUS),
    contractKinds: new Set(),
    layers: new Set(),
  };
}

interface DashboardState {
  graph: RebuildGraph | null;
  nodesById: Map<string, RebuildNode>;
  loadError: string | null;
  viewMode: ViewMode;
  selectedNodeId: string | null;
  searchQuery: string;
  filters: Filters;
  filterPanelOpen: boolean;
  /** Set when a view (e.g. ContractInventory) wants the graph to focus a node. */
  focusRequest: string | null;

  setGraph: (g: RebuildGraph) => void;
  setLoadError: (e: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  selectNode: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  toggleFilterPanel: () => void;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  hasActiveFilters: () => boolean;
  /** Switch to graph view and focus a node (used by tables). */
  focusGraphNode: (id: string) => void;
  clearFocusRequest: () => void;
}

export const useStore = create<DashboardState>((set, get) => ({
  graph: null,
  nodesById: new Map(),
  loadError: null,
  viewMode: "graph",
  selectedNodeId: null,
  searchQuery: "",
  filters: defaultFilters(),
  filterPanelOpen: false,
  focusRequest: null,

  setGraph: (g) => {
    const nodesById = new Map<string, RebuildNode>();
    for (const n of g.nodes) nodesById.set(n.id, n);
    // Default: show every layer the graph actually contains.
    const layers = new Set(g.layers.map((l) => l.id));
    set({
      graph: g,
      nodesById,
      selectedNodeId: null,
      filters: { ...defaultFilters(), layers },
    });
  },
  setLoadError: (e) => set({ loadError: e }),
  setViewMode: (m) => set({ viewMode: m }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleFilterPanel: () => set((s) => ({ filterPanelOpen: !s.filterPanelOpen })),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => {
    const g = get().graph;
    const layers = g ? new Set(g.layers.map((l) => l.id)) : new Set<string>();
    set({ filters: { ...defaultFilters(), layers } });
  },
  hasActiveFilters: () => {
    const { filters, graph } = get();
    if (!graph) return false;
    return (
      filters.nodeTypes.size !== ALL_NODE_TYPES.length ||
      filters.coverage.size !== ALL_COVERAGE.length ||
      filters.priorities.size !== ALL_PRIORITIES.length + 1 ||
      filters.rebuildStatus.size !== ALL_REBUILD_STATUS.length ||
      filters.contractKinds.size > 0 ||
      filters.layers.size !== graph.layers.length
    );
  },
  focusGraphNode: (id) =>
    set({ viewMode: "graph", selectedNodeId: id, focusRequest: id }),
  clearFocusRequest: () => set({ focusRequest: null }),
}));

/** Does a node pass the current filter set? Shared by graph + tables. */
export function nodePassesFilters(node: RebuildNode, filters: Filters): boolean {
  if (!filters.nodeTypes.has(node.type)) return false;
  if (!filters.coverage.has(node.rebuild.coverage)) return false;
  const prio = node.rebuild.priority ?? "none";
  if (!filters.priorities.has(prio)) return false;
  if (!filters.rebuildStatus.has(node.rebuild.rebuildStatus)) return false;
  if (filters.layers.size > 0 && !filters.layers.has(node.layer)) return false;
  if (filters.contractKinds.size > 0) {
    if (!node.rebuild.contractKind) return false;
    if (!filters.contractKinds.has(node.rebuild.contractKind)) return false;
  }
  return true;
}
