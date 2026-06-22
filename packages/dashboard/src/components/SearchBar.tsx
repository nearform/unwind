import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

const DEBOUNCE_MS = 250;

export default function SearchBar() {
  const committedQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const graph = useStore((s) => s.graph);
  const viewMode = useStore((s) => s.viewMode);

  // Local input value updates instantly; the store (which drives the expensive
  // graph re-layout) is updated on a debounce so typing stays smooth.
  const [value, setValue] = useState(committedQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local input in sync if the query is cleared elsewhere.
  useEffect(() => {
    setValue(committedQuery);
  }, [committedQuery]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearchQuery(next.trim()), DEBOUNCE_MS);
  }

  function commitNow(next: string) {
    if (timer.current) clearTimeout(timer.current);
    setSearchQuery(next.trim());
  }

  // Match count tracks the live input value (instant feedback), independent of
  // the debounced layout.
  const matchCount = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!graph || !q) return 0;
    return graph.nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.filePath.toLowerCase().includes(q),
    ).length;
  }, [graph, value]);

  if (viewMode !== "graph") return null;

  const pending = value.trim() !== committedQuery;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border-subtle">
      <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitNow(value);
          if (e.key === "Escape") {
            setValue("");
            commitNow("");
          }
        }}
        placeholder="Search nodes by name or path…"
        className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/60 placeholder-text-muted"
      />
      {value.trim() && (
        <span className="text-xs text-text-muted shrink-0">
          {matchCount} match{matchCount !== 1 ? "es" : ""}
          {pending ? " · …" : ""}
        </span>
      )}
    </div>
  );
}
