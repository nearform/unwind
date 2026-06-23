import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { DocFile } from "../types";
import MarkdownView from "./MarkdownView";

/** Human label for a sidebar group (layer folder name → Title Case). */
function groupLabel(group: string): string {
  if (group === "Overview") return "Overview";
  return group.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DocsViewer() {
  const bundle = useStore((s) => s.docsBundle);
  const error = useStore((s) => s.docsError);
  const selectedDocPath = useStore((s) => s.selectedDocPath);
  const selectDoc = useStore((s) => s.selectDoc);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    if (!bundle) return [];
    const q = query.trim().toLowerCase();
    const byGroup = new Map<string, DocFile[]>();
    for (const f of bundle.files) {
      if (q && !f.title.toLowerCase().includes(q) && !f.path.toLowerCase().includes(q)) continue;
      const arr = byGroup.get(f.group) ?? [];
      arr.push(f);
      byGroup.set(f.group, arr);
    }
    return [...byGroup.entries()].map(([group, files]) => ({ group, files }));
  }, [bundle, query]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center text-sm text-text-muted">
        <div>
          <div className="text-[var(--color-cov-stale)] mb-1">{error}</div>
          Run <code className="font-mono">build-graph.mjs</code> to generate{" "}
          <code className="font-mono">docs-bundle.json</code>.
        </div>
      </div>
    );
  }
  if (!bundle) {
    return <div className="h-full flex items-center justify-center text-sm text-text-muted">Loading docs…</div>;
  }
  if (bundle.files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-text-muted">
        No markdown docs found under <code className="font-mono ml-1">docs/unwind</code>.
      </div>
    );
  }

  const active = bundle.files.find((f) => f.path === selectedDocPath) ?? bundle.files[0];

  return (
    <div className="h-full flex min-h-0">
      {/* Sidebar: doc tree, grouped by Overview + layer. */}
      <aside className="w-64 shrink-0 bg-surface border-r border-border-subtle flex flex-col min-h-0">
        <div className="p-2 border-b border-border-subtle shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter docs…"
            className="w-full bg-root border border-border-subtle rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <nav className="flex-1 overflow-auto p-2 space-y-3">
          {groups.length === 0 && (
            <div className="px-2 py-1 text-xs text-text-muted">No matching docs.</div>
          )}
          {groups.map(({ group, files }) => (
            <div key={group}>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {groupLabel(group)}
              </div>
              <ul className="space-y-0.5">
                {files.map((f) => {
                  const isActive = f.path === active.path;
                  return (
                    <li key={f.path}>
                      <button
                        onClick={() => selectDoc(f.path)}
                        title={f.path}
                        className={`w-full text-left px-2 py-1 rounded-md text-xs truncate transition-colors ${
                          isActive
                            ? "bg-accent/20 text-accent"
                            : "text-text-secondary hover:bg-elevated hover:text-text-primary"
                        }`}
                      >
                        {f.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content pane. */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-root">
        <div className="px-6 py-2 border-b border-border-subtle shrink-0 bg-surface">
          <div className="text-sm text-text-primary truncate">{active.title}</div>
          <div className="font-mono text-[10px] text-text-muted truncate">
            {bundle.root}/{active.path}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          <MarkdownView content={active.content} docPath={active.path} onNavigate={selectDoc} />
        </div>
      </div>
    </div>
  );
}
