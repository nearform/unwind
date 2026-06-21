import { useStore } from "../store";
import type { Filters } from "../store";
import {
  ALL_CONTRACT_KINDS,
  ALL_COVERAGE,
  ALL_NODE_TYPES,
  ALL_PRIORITIES,
  ALL_REBUILD_STATUS,
} from "../types";

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function Section<T extends string>({
  title,
  values,
  active,
  onToggle,
}: {
  title: string;
  values: readonly T[];
  active: Set<T>;
  onToggle: (v: T) => void;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
        {title}
      </h3>
      <div className="space-y-1">
        {values.map((v) => (
          <label
            key={v}
            className="flex items-center gap-2 cursor-pointer hover:bg-elevated/60 rounded px-1.5 py-0.5"
          >
            <input
              type="checkbox"
              checked={active.has(v)}
              onChange={() => onToggle(v)}
              className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer"
            />
            <span className="text-xs text-text-primary capitalize">
              {String(v).replace(/-/g, " ")}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function FilterPanel() {
  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const resetFilters = useStore((s) => s.resetFilters);
  const open = useStore((s) => s.filterPanelOpen);
  const toggleOpen = useStore((s) => s.toggleFilterPanel);
  const active = useStore((s) => s.hasActiveFilters());

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters({ [key]: value } as Partial<Filters>);

  return (
    <div className="relative">
      <button
        onClick={toggleOpen}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
          active
            ? "bg-accent/20 text-accent"
            : "bg-elevated text-text-secondary hover:text-text-primary"
        }`}
        title="Filter"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filter
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 max-h-[70vh] overflow-auto bg-panel border border-border-medium rounded-lg shadow-xl z-50 p-4 space-y-4">
          <Section
            title="Priority"
            values={[...ALL_PRIORITIES, "none"] as const}
            active={filters.priorities}
            onToggle={(v) => set("priorities", toggle(filters.priorities, v))}
          />
          <Section
            title="Coverage"
            values={ALL_COVERAGE}
            active={filters.coverage}
            onToggle={(v) => set("coverage", toggle(filters.coverage, v))}
          />
          <Section
            title="Rebuild Status"
            values={ALL_REBUILD_STATUS}
            active={filters.rebuildStatus}
            onToggle={(v) => set("rebuildStatus", toggle(filters.rebuildStatus, v))}
          />
          <Section
            title="Node Type"
            values={ALL_NODE_TYPES}
            active={filters.nodeTypes}
            onToggle={(v) => set("nodeTypes", toggle(filters.nodeTypes, v))}
          />
          <Section
            title="Contract Kind"
            values={ALL_CONTRACT_KINDS}
            active={filters.contractKinds}
            onToggle={(v) => set("contractKinds", toggle(filters.contractKinds, v))}
          />
          {graph && graph.layers.length > 0 && (
            <Section
              title="Layer"
              values={graph.layers.map((l) => l.id)}
              active={filters.layers}
              onToggle={(v) => set("layers", toggle(filters.layers, v))}
            />
          )}
          {active && (
            <button
              onClick={resetFilters}
              className="w-full px-3 py-1.5 text-xs bg-elevated hover:bg-accent/20 text-text-secondary hover:text-accent rounded-lg"
            >
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
