import { useMemo, useState } from "react";
import { useStore } from "../store";
import { coverageColor, priorityColor, statusLabel } from "../colors";
import { sourceLink, type ContractKind } from "../types";

export default function ContractInventory() {
  const graph = useStore((s) => s.graph);
  const focusGraphNode = useStore((s) => s.focusGraphNode);
  const [kindFilter, setKindFilter] = useState<ContractKind | "all">("all");
  const [query, setQuery] = useState("");

  const contracts = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n) => n.rebuild.contractKind != null);
  }, [graph]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    for (const c of contracts) if (c.rebuild.contractKind) s.add(c.rebuild.contractKind);
    return [...s].sort();
  }, [contracts]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts.filter((c) => {
      if (kindFilter !== "all" && c.rebuild.contractKind !== kindFilter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.filePath.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [contracts, kindFilter, query]);

  if (!graph) return null;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg text-text-primary font-semibold mb-1">Contract Inventory</h2>
      <p className="text-sm text-text-muted mb-4">
        Every node with a contract kind (tables, endpoints, event schemas, formulas). Click a row to
        focus it in the graph.
      </p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setKindFilter("all")}
          className={`text-xs px-2.5 py-1 rounded border ${
            kindFilter === "all" ? "border-accent text-accent" : "border-border-subtle text-text-muted"
          }`}
        >
          all ({contracts.length})
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k as ContractKind)}
            className={`text-xs px-2.5 py-1 rounded border ${
              kindFilter === k ? "border-accent text-accent" : "border-border-subtle text-text-muted"
            }`}
          >
            {k}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="ml-auto bg-elevated text-text-primary text-xs rounded-lg px-3 py-1 border border-border-subtle focus:outline-none focus:border-accent/50"
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">
          No contracts found. (Contracts appear once structural extraction emits tables/endpoints.)
        </p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-text-muted border-b border-border-subtle">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 px-3 font-medium">Kind</th>
              <th className="py-2 px-3 font-medium">Priority</th>
              <th className="py-2 px-3 font-medium">Coverage</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const link = sourceLink(
                graph.repository.linkFormat,
                c.filePath,
                c.lineRange.start,
                c.lineRange.end,
              );
              return (
                <tr
                  key={c.id}
                  onClick={() => focusGraphNode(c.id)}
                  className="border-b border-border-subtle/50 hover:bg-elevated/50 cursor-pointer"
                >
                  <td className="py-2 pr-4 text-text-primary">
                    {c.name}
                    <div className="font-mono text-[10px] text-text-muted truncate max-w-xs">
                      {c.filePath}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{c.rebuild.contractKind}</td>
                  <td className="py-2 px-3">
                    {c.rebuild.priority ? (
                      <span style={{ color: priorityColor(c.rebuild.priority) }}>{c.rebuild.priority}</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: coverageColor(c.rebuild.coverage) }} />
                      {c.rebuild.coverage}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-text-secondary capitalize">{statusLabel(c.rebuild.rebuildStatus)}</td>
                  <td className="py-2 px-3">
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-accent hover:underline text-xs"
                      >
                        link ↗
                      </a>
                    ) : (
                      <span className="text-text-muted text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
