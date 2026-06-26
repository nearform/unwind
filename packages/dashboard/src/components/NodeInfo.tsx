import { useStore } from "../store";
import { coverageColor, nodeTypeColor, priorityColor, rebuiltStateColor, statusLabel } from "../colors";
import { sourceLink } from "../types";

export default function NodeInfo({
  onOpenCode,
}: {
  onOpenCode: (id: string) => void;
}) {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const nodesById = useStore((s) => s.nodesById);
  const selectNode = useStore((s) => s.selectNode);
  const focusGraphNode = useStore((s) => s.focusGraphNode);

  const node = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  if (!node) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-text-muted text-sm text-center">
          Select a node to inspect its rebuild metadata.
        </p>
      </div>
    );
  }

  const r = node.rebuild;
  const connections = (graph?.edges ?? []).filter(
    (e) => e.source === node.id || e.target === node.id,
  );
  const link = sourceLink(
    graph?.repository.linkFormat ?? "",
    node.filePath,
    node.lineRange.start,
    node.lineRange.end,
  );

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
          style={{ color: nodeTypeColor(node.type), border: `1px solid ${nodeTypeColor(node.type)}` }}
        >
          {node.type}
        </span>
        {r.priority && (
          <span
            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
            style={{ color: priorityColor(r.priority), border: `1px solid ${priorityColor(r.priority)}` }}
          >
            {r.priority}
          </span>
        )}
      </div>

      <h2 className="text-base text-text-primary font-semibold mb-1 break-words">{node.name}</h2>
      <div className="font-mono text-[11px] text-text-muted mb-3 break-all">
        {node.filePath}:{node.lineRange.start}-{node.lineRange.end}
      </div>

      {node.summary && (
        <p className="text-sm text-text-secondary mb-3 leading-relaxed">{node.summary}</p>
      )}

      {/* Rebuild block */}
      <div className="rounded-lg border border-border-subtle bg-elevated/50 p-3 mb-3 space-y-2">
        <h3 className="text-[10px] font-semibold text-accent uppercase tracking-wider">Rebuild</h3>
        <Row label="Coverage">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: coverageColor(r.coverage) }} />
            {r.coverage}
          </span>
        </Row>
        <Row label="Priority">{r.priority ?? "—"}</Row>
        <Row label="Status">{statusLabel(r.rebuildStatus)}</Row>
        <Row label="Contract">{r.contractKind ?? "—"}</Row>
        <Row label="Layer">{node.layer}</Row>
        <Row label="Doc ref">
          {r.docRef ? <span className="font-mono text-[10px] break-all">{r.docRef}</span> : "—"}
        </Row>
      </div>

      {/* Build assets — where this node was rebuilt in the target stack (uw-build). */}
      {r.target && r.target.files.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-elevated/50 p-3 mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold text-accent uppercase tracking-wider">Rebuilt as</h3>
            {r.target.state && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rebuiltStateColor(r.target.state) }} />
                {r.target.state}
                {r.target.confirmed ? <span className="text-text-muted" title="Confirmed by a re-scan of the target repo">✓</span> : null}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {r.target.files.map((f) => (
              <div key={f} className="font-mono text-[11px] text-text-primary break-all">{f}</div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => onOpenCode(node.id)}
          className="flex-1 text-[11px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border border-accent/30 text-accent hover:border-accent/60"
        >
          Open code
        </button>
        <button
          onClick={() => focusGraphNode(node.id)}
          className="flex-1 text-[11px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border border-border-subtle text-text-secondary hover:text-accent hover:border-accent/30"
        >
          Focus
        </button>
      </div>

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="block text-center text-[11px] text-accent hover:underline mb-3"
        >
          View on remote ↗
        </a>
      )}

      {node.tags && node.tags.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-1.5">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((t) => (
              <span key={t} className="text-[10px] text-text-secondary px-2 py-0.5 rounded-full border border-border-subtle">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {connections.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-1.5">
            Connections ({connections.length})
          </h3>
          <div className="space-y-1">
            {connections.slice(0, 40).map((e, i) => {
              const isSource = e.source === node.id;
              const otherId = isSource ? e.target : e.source;
              const other = nodesById.get(otherId);
              return (
                <button
                  key={i}
                  onClick={() => selectNode(otherId)}
                  className="w-full text-left text-xs bg-elevated rounded px-2 py-1.5 border border-border-subtle flex items-center gap-2 hover:border-accent/40"
                >
                  <span className="text-accent font-mono">{isSource ? "→" : "←"}</span>
                  <span className="text-text-muted shrink-0">{e.type}</span>
                  <span className="text-text-primary truncate">{other?.name ?? otherId}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary capitalize">{children}</span>
    </div>
  );
}
