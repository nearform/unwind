import { useStore } from "../store";
import { layerShortLabel } from "../colors";

/**
 * Fast per-layer toggles in the header. Each chip flips a layer's visibility in
 * `filters.layers` (shared with the Filter panel). All chips share one style:
 * active = accent, inactive = dimmed. "All" / "None" select or clear every layer.
 */
export default function LayerChips() {
  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);

  if (!graph || graph.layers.length === 0) return null;

  const allIds = graph.layers.map((l) => l.id);
  const allOn = allIds.every((id) => filters.layers.has(id));
  const noneOn = !allIds.some((id) => filters.layers.has(id));

  const toggle = (id: string) => {
    const next = new Set(filters.layers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFilters({ layers: next });
  };

  return (
    <div className="flex items-center gap-1">
      {graph.layers.map((l) => {
        const active = filters.layers.has(l.id);
        return (
          <button
            key={l.id}
            onClick={() => toggle(l.id)}
            title={`${l.label} — ${l.nodeCount} nodes (click to ${active ? "hide" : "show"})`}
            className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              active
                ? "text-accent border-accent bg-accent/15"
                : "text-text-muted border-border-subtle opacity-60 hover:opacity-100"
            }`}
          >
            {layerShortLabel(l.id)}
          </button>
        );
      })}
      <button
        onClick={() => setFilters({ layers: new Set(allIds) })}
        disabled={allOn}
        title="Show all layers"
        className="px-2 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-accent border border-border-subtle hover:border-accent/50 transition-colors disabled:opacity-40 disabled:hover:text-text-secondary disabled:hover:border-border-subtle"
      >
        All
      </button>
      <button
        onClick={() => setFilters({ layers: new Set() })}
        disabled={noneOn}
        title="Hide all layers"
        className="px-2 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-accent border border-border-subtle hover:border-accent/50 transition-colors disabled:opacity-40 disabled:hover:text-text-secondary disabled:hover:border-border-subtle"
      >
        None
      </button>
    </div>
  );
}
