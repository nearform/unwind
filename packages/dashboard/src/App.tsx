import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import type { ViewMode } from "./store";
import { validateRebuildGraphShape, type RebuildGraph } from "./types";
import { decodeState, encodeState, writeUrl } from "./urlState";
import GraphView from "./components/GraphView";
import SearchBar from "./components/SearchBar";
import FilterPanel from "./components/FilterPanel";
import LayerChips from "./components/LayerChips";
import NodeInfo from "./components/NodeInfo";
import CodeViewer from "./components/CodeViewer";
import RebuildOverview from "./components/RebuildOverview";
import PriorityBreakdown from "./components/PriorityBreakdown";
import ContractInventory from "./components/ContractInventory";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "overview", label: "Coverage" },
  { id: "priorities", label: "Priorities" },
  { id: "contracts", label: "Contracts" },
];

export default function App() {
  const graph = useStore((s) => s.graph);
  const setGraph = useStore((s) => s.setGraph);
  const loadError = useStore((s) => s.loadError);
  const setLoadError = useStore((s) => s.setLoadError);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const [codeNodeId, setCodeNodeId] = useState<string | null>(null);
  const urlApplied = useRef(false);
  const fetchStarted = useRef(false);

  // Reflect the theme onto <html> so the CSS variables switch.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Once the graph is loaded, hydrate filter/search/view state FROM the URL
  // (layer defaults depend on the graph, so this must run after setGraph).
  useEffect(() => {
    if (!graph || urlApplied.current) return;
    urlApplied.current = true;
    const s = decodeState(window.location.search, graph);
    if (s.filters) setFilters(s.filters);
    if (s.searchQuery !== undefined) setSearchQuery(s.searchQuery);
    if (s.viewMode) setViewMode(s.viewMode);
  }, [graph, setFilters, setSearchQuery, setViewMode]);

  // After hydration, mirror state changes back into the URL (shareable, sticky).
  useEffect(() => {
    if (!graph || !urlApplied.current) return;
    writeUrl(encodeState(filters, searchQuery, viewMode, graph));
  }, [graph, filters, searchQuery, viewMode]);

  useEffect(() => {
    // Guard against React StrictMode's double-invoke in dev: a second setGraph
    // would reset filters AFTER the URL is hydrated.
    if (fetchStarted.current) return;
    fetchStarted.current = true;
    fetch("/rebuild-graph.json")
      .then(async (res) => {
        const data: unknown = await res.json();
        if (!res.ok) {
          const msg =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : "Failed to load rebuild-graph.json";
          throw new Error(msg);
        }
        const problem = validateRebuildGraphShape(data);
        if (problem) throw new Error(`Invalid rebuild graph: ${problem}`);
        setGraph(data as RebuildGraph);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }, [setGraph, setLoadError]);

  return (
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 bg-surface border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Official Nearform mark (navy N) on a white chip so it reads on any header theme. */}
          <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-white border border-border-subtle">
            <img src="/nearform.svg" alt="Nearform" className="w-5 h-5" />
          </span>
          <div className="flex items-baseline min-w-0">
            <h1 className="text-base font-semibold tracking-wide text-accent shrink-0">Unwind</h1>
            {graph?.repository?.url ? (
              <a
                href={graph.repository.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${graph.repository.url} in a new tab`}
                className="text-base font-semibold text-text-secondary hover:text-accent truncate underline-offset-2 hover:underline"
              >
                :&nbsp;{graph.project.name}
              </a>
            ) : (
              <span className="text-base font-semibold text-text-secondary truncate">
                :&nbsp;{graph?.project.name ?? "Rebuild Graph"}
              </span>
            )}
          </div>
        </div>

        <nav className="flex items-center bg-elevated rounded-lg p-0.5 ml-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setViewMode(v.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === v.id
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>

        {/* Fast per-layer filters */}
        <div className="h-5 w-px bg-border-subtle ml-1" />
        <LayerChips />

        <div className="flex-1" />

        {graph && (
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{graph.stats.nodeCount} nodes</span>
            <span>{graph.stats.edgeCount} edges</span>
            <span className="text-accent">{graph.stats.coveragePct}% covered</span>
          </div>
        )}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label="Toggle color theme"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-accent hover:border-accent/50 transition-colors"
        >
          {theme === "dark" ? (
            // sun
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            // moon
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
            </svg>
          )}
        </button>
        {viewMode === "graph" && <FilterPanel />}
      </header>

      {/* Search (graph view only) */}
      <SearchBar />

      {loadError && (
        <div className="px-5 py-3 bg-[rgba(224,82,82,0.15)] border-b border-[rgba(224,82,82,0.4)] text-[var(--color-cov-stale)] text-sm">
          {loadError} — run <code className="font-mono">build-graph.mjs</code> to generate the graph.
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex min-h-0 relative">
        <div className="flex-1 min-w-0 min-h-0 relative">
          {!graph && !loadError && (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Loading rebuild graph…
            </div>
          )}
          {graph && viewMode === "graph" && <GraphView />}
          {graph && viewMode === "overview" && <RebuildOverview />}
          {graph && viewMode === "priorities" && <PriorityBreakdown />}
          {graph && viewMode === "contracts" && <ContractInventory />}
        </div>

        {/* Sidebar: node info (graph view) */}
        {viewMode === "graph" && (
          <aside className="w-[320px] shrink-0 bg-surface border-l border-border-subtle overflow-hidden">
            <NodeInfo onOpenCode={(id) => setCodeNodeId(id)} />
          </aside>
        )}

        {/* Code viewer overlay */}
        {codeNodeId && (
          <div className="absolute bottom-0 left-0 right-0 h-[45vh] bg-surface border-t border-border-medium z-20">
            <CodeViewer nodeId={codeNodeId} onClose={() => setCodeNodeId(null)} />
          </div>
        )}
      </div>

      {/* Footer status */}
      {selectedNodeId && viewMode !== "graph" && (
        <div className="px-5 py-1.5 bg-surface border-t border-border-subtle text-xs text-text-muted shrink-0">
          Selected: {selectedNodeId}
        </div>
      )}
    </div>
  );
}
