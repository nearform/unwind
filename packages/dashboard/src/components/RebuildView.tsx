import { useMemo, useState } from "react";
import { useStore } from "../store";
import { priorityColor, rebuiltStateColor } from "../colors";
import type { RebuildNode } from "../types";

/**
 * Rebuild view — the "build assets" produced by `uw-build`: the source→target
 * file mapping plus the headline verification completeness. Reads the data folded
 * into rebuild-graph.json by build-graph.mjs (each node's `rebuild.target` and the
 * graph-level `rebuildVerification`), so no extra fetch is needed.
 */
export default function RebuildView() {
  const graph = useStore((s) => s.graph);
  const focusGraphNode = useStore((s) => s.focusGraphNode);
  const [stateFilter, setStateFilter] = useState<string | "all">("all");
  const [query, setQuery] = useState("");

  // Every node that was actually rebuilt into one or more target files.
  const mapped = useMemo<RebuildNode[]>(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.rebuild.target && n.rebuild.target.files.length > 0)
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }, [graph]);

  const states = useMemo(() => {
    const s = new Set<string>();
    for (const n of mapped) if (n.rebuild.target?.state) s.add(n.rebuild.target.state);
    return [...s].sort();
  }, [mapped]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mapped.filter((n) => {
      const t = n.rebuild.target!;
      if (stateFilter !== "all" && t.state !== stateFilter) return false;
      if (q) {
        const hay = `${n.name} ${n.filePath} ${t.files.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mapped, stateFilter, query]);

  if (!graph) return null;

  const rv = graph.rebuildVerification;

  if (mapped.length === 0 && !rv) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-text-muted text-sm text-center max-w-md">
          No rebuild assets yet. Run <code className="font-mono">unwind:uw-build</code> to rebuild
          the project in the target stack, then re-open the dashboard — the rebuilt target files and
          completeness will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg text-text-primary font-semibold mb-1">Rebuild</h2>
      <p className="text-sm text-text-muted mb-5">
        Where each source item was rebuilt in the target stack
        {rv?.targetProject ? (
          <>
            {" "}
            (<span className="text-text-secondary">{rv.targetProject.name}</span>
            {rv.targetProject.root ? (
              <span className="font-mono text-[11px]"> · {rv.targetProject.root}</span>
            ) : null}
            )
          </>
        ) : null}
        . Click a row to focus the source node in the graph.
      </p>

      {/* Completeness summary */}
      {rv && (
        <div className="bg-elevated/40 border border-border-subtle rounded-lg p-4 mb-6 max-w-3xl">
          <div className="flex items-baseline gap-3 mb-3">
            <span
              className="text-3xl font-bold"
              style={{ color: rebuiltStateColor(rv.completenessPct >= 100 ? "equivalent" : "divergent") }}
            >
              {rv.completenessPct}%
            </span>
            <span className="text-sm text-text-secondary">
              {rv.mustEquivalentOrPresent}/{rv.totalMust} <span className="text-text-muted">[MUST] equivalent or present</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(rv.byRebuiltState)
              .sort((a, b) => b[1] - a[1])
              .map(([state, count]) => (
                <span key={state} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: rebuiltStateColor(state) }} />
                  {state} <span className="text-text-muted">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setStateFilter("all")}
          className={`text-xs px-2.5 py-1 rounded border ${
            stateFilter === "all" ? "border-accent text-accent" : "border-border-subtle text-text-muted"
          }`}
        >
          all ({mapped.length})
        </button>
        {states.map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            className={`text-xs px-2.5 py-1 rounded border ${
              stateFilter === s ? "border-accent text-accent" : "border-border-subtle text-text-muted"
            }`}
          >
            {s}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search source or target…"
          className="ml-auto bg-elevated text-text-primary text-xs rounded-lg px-3 py-1 border border-border-subtle focus:outline-none focus:border-accent/50"
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No matching rebuilt items.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-text-muted border-b border-border-subtle">
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 px-3 font-medium">Layer</th>
              <th className="py-2 px-3 font-medium">Priority</th>
              <th className="py-2 px-3 font-medium">State</th>
              <th className="py-2 px-3 font-medium">Target files</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const t = n.rebuild.target!;
              return (
                <tr
                  key={n.id}
                  onClick={() => focusGraphNode(n.id)}
                  className="border-b border-border-subtle/50 hover:bg-elevated/50 cursor-pointer align-top"
                >
                  <td className="py-2 pr-4 text-text-primary">
                    {n.name}
                    <div className="font-mono text-[10px] text-text-muted truncate max-w-xs">{n.filePath}</div>
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{n.layer}</td>
                  <td className="py-2 px-3">
                    {n.rebuild.priority ? (
                      <span style={{ color: priorityColor(n.rebuild.priority) }}>{n.rebuild.priority}</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {t.state ? (
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rebuiltStateColor(t.state) }} />
                        {t.state}
                        {t.confirmed ? <span className="text-text-muted" title="Confirmed by a re-scan of the target repo">✓</span> : null}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-col gap-0.5">
                      {t.files.map((f) => (
                        <span key={f} className="font-mono text-[11px] text-text-secondary break-all">{f}</span>
                      ))}
                    </div>
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
