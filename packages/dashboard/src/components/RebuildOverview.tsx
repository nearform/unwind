import { useMemo } from "react";
import { useStore } from "../store";
import { coverageColor } from "../colors";
import type { CoverageState } from "../types";

const ORDER: CoverageState[] = ["verified", "documented", "scanned", "excluded", "stale"];

export default function RebuildOverview() {
  const graph = useStore((s) => s.graph);

  const perLayer = useMemo(() => {
    if (!graph) return [];
    const byLayer = new Map<string, Record<CoverageState, number>>();
    for (const n of graph.nodes) {
      let rec = byLayer.get(n.layer);
      if (!rec) {
        rec = { scanned: 0, documented: 0, verified: 0, excluded: 0, stale: 0 };
        byLayer.set(n.layer, rec);
      }
      rec[n.rebuild.coverage]++;
    }
    return graph.layers
      .filter((l) => byLayer.has(l.id))
      .map((l) => {
        const rec = byLayer.get(l.id)!;
        const total = ORDER.reduce((s, k) => s + rec[k], 0);
        const done = rec.verified + rec.documented;
        return { layer: l, rec, total, pct: total ? Math.round((done / total) * 100) : 0 };
      });
  }, [graph]);

  if (!graph) return null;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg text-text-primary font-semibold mb-1">Rebuild Coverage</h2>
      <p className="text-sm text-text-muted mb-6">
        Per-layer documentation coverage. {graph.stats.coveragePct}% of {graph.stats.nodeCount} nodes
        are documented or verified overall.
      </p>

      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {ORDER.map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: coverageColor(c) }} />
            {c}
          </span>
        ))}
      </div>

      <div className="space-y-4 max-w-3xl">
        {perLayer.map(({ layer, rec, total, pct }) => (
          <div key={layer.id} className="bg-elevated/40 border border-border-subtle rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-text-primary">{layer.label}</span>
              <span className="text-xs text-text-muted">
                {rec.verified + rec.documented}/{total} ({pct}%)
              </span>
            </div>
            <div className="flex h-4 rounded overflow-hidden bg-root">
              {ORDER.map((c) =>
                rec[c] > 0 ? (
                  <div
                    key={c}
                    title={`${c}: ${rec[c]}`}
                    style={{ width: `${(rec[c] / total) * 100}%`, backgroundColor: coverageColor(c) }}
                  />
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
