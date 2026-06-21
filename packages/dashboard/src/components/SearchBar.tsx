import { useStore } from "../store";

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const graph = useStore((s) => s.graph);
  const viewMode = useStore((s) => s.viewMode);

  if (viewMode !== "graph") return null;

  const matchCount = graph
    ? graph.nodes.filter((n) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return false;
        return (
          n.name.toLowerCase().includes(q) ||
          n.filePath.toLowerCase().includes(q)
        );
      }).length
    : 0;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border-subtle">
      <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search nodes by name or path…"
        className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
      />
      {searchQuery.trim() && (
        <span className="text-xs text-text-muted shrink-0">{matchCount} match{matchCount !== 1 ? "es" : ""}</span>
      )}
    </div>
  );
}
