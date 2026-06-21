import { useMemo } from "react";
import { useStore } from "../store";
import { priorityColor } from "../colors";

type PrioKey = "MUST" | "SHOULD" | "DON'T" | "none";
const ORDER: PrioKey[] = ["MUST", "SHOULD", "DON'T", "none"];

export default function PriorityBreakdown() {
  const graph = useStore((s) => s.graph);

  const rows = useMemo(() => {
    if (!graph) return [];
    const byLayer = new Map<string, Record<PrioKey, number>>();
    for (const n of graph.nodes) {
      let rec = byLayer.get(n.layer);
      if (!rec) {
        rec = { MUST: 0, SHOULD: 0, "DON'T": 0, none: 0 };
        byLayer.set(n.layer, rec);
      }
      rec[(n.rebuild.priority ?? "none") as PrioKey]++;
    }
    return graph.layers
      .filter((l) => byLayer.has(l.id))
      .map((l) => ({ layer: l, rec: byLayer.get(l.id)! }));
  }, [graph]);

  if (!graph) return null;

  const totals: Record<PrioKey, number> = { MUST: 0, SHOULD: 0, "DON'T": 0, none: 0 };
  for (const { rec } of rows) for (const k of ORDER) totals[k] += rec[k];

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg text-text-primary font-semibold mb-1">Priority Breakdown</h2>
      <p className="text-sm text-text-muted mb-6">
        MUST / SHOULD / DON'T counts per layer (from documented priority tags).
      </p>

      <table className="w-full max-w-3xl text-sm border-collapse">
        <thead>
          <tr className="text-left text-text-muted border-b border-border-subtle">
            <th className="py-2 pr-4 font-medium">Layer</th>
            {ORDER.map((k) => (
              <th key={k} className="py-2 px-3 font-medium text-right">
                <span style={{ color: k === "none" ? "var(--color-text-muted)" : priorityColor(k as never) }}>
                  {k === "none" ? "untagged" : k}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ layer, rec }) => (
            <tr key={layer.id} className="border-b border-border-subtle/50">
              <td className="py-2 pr-4 text-text-primary">{layer.label}</td>
              {ORDER.map((k) => (
                <td key={k} className="py-2 px-3 text-right text-text-secondary font-mono">
                  {rec[k] || "·"}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold text-text-primary">
            <td className="py-2 pr-4">Total</td>
            {ORDER.map((k) => (
              <td key={k} className="py-2 px-3 text-right font-mono">
                {totals[k]}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
