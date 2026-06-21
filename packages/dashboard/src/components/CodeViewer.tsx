import { useEffect, useState } from "react";
import { useStore } from "../store";

interface SourceFile {
  path: string;
  content: string;
  lineCount: number;
}

type State =
  | { status: "idle" | "loading" }
  | { status: "loaded"; source: SourceFile }
  | { status: "error"; error: string };

export default function CodeViewer({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const nodesById = useStore((s) => s.nodesById);
  const node = nodesById.get(nodeId) ?? null;
  const [state, setState] = useState<State>({ status: "idle" });

  const start = node?.lineRange.start ?? 0;
  const end = node?.lineRange.end ?? 0;

  useEffect(() => {
    if (!node) {
      setState({ status: "error", error: "Node not found." });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/file-content.json?path=${encodeURIComponent(node.filePath)}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as SourceFile | { error?: string };
        if (!res.ok) {
          throw new Error("error" in data && data.error ? data.error : "Source unavailable");
        }
        setState({ status: "loaded", source: data as SourceFile });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [node]);

  return (
    <div className="h-full w-full flex flex-col bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-elevated border-b border-border-subtle shrink-0">
        <div className="min-w-0">
          <div className="text-sm text-text-primary truncate">{node?.name}</div>
          <div className="font-mono text-[10px] text-text-muted truncate">{node?.filePath}</div>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg px-2">
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-root">
        {state.status === "loading" && <div className="p-4 text-sm text-text-muted">Loading…</div>}
        {state.status === "error" && <div className="p-4 text-sm text-[var(--color-cov-stale)]">{state.error}</div>}
        {state.status === "loaded" && (
          <pre className="text-xs font-mono leading-relaxed p-0 m-0">
            {state.source.content.split(/\r\n|\n|\r/).map((line, i) => {
              const ln = i + 1;
              const inRange = ln >= start && ln <= end;
              return (
                <div
                  key={i}
                  className="flex"
                  style={inRange ? { background: "rgba(212,165,116,0.12)" } : undefined}
                >
                  <span className="inline-block w-12 text-right pr-3 text-text-muted select-none shrink-0">
                    {ln}
                  </span>
                  <span className="text-text-secondary whitespace-pre-wrap break-all">{line || " "}</span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
