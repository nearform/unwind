import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { useStore, nodePassesFilters } from "../store";
import { layoutGraph } from "../elk-layout";
import RebuildNodeView from "./RebuildNodeView";
import type { RebuildFlowNode } from "./RebuildNodeView";

const nodeTypes = { rebuild: RebuildNodeView };

// Cap rendered nodes so very large repos stay interactive. The filter panel +
// search narrow this; when capped we surface a banner.
const MAX_RENDER_NODES = 400;

function GraphInner() {
  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const searchQuery = useStore((s) => s.searchQuery);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectNode = useStore((s) => s.selectNode);
  const focusRequest = useStore((s) => s.focusRequest);
  const clearFocusRequest = useStore((s) => s.clearFocusRequest);
  const theme = useStore((s) => s.theme);

  const [layouted, setLayouted] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [capped, setCapped] = useState(0);
  const { fitView } = useReactFlow();

  // 1. Filter + (optional) focus to a node's 1-hop neighborhood, build flow data.
  const built = useMemo(() => {
    if (!graph) return null;
    const q = searchQuery.trim().toLowerCase();
    let visible = graph.nodes.filter((n) => nodePassesFilters(n, filters));
    if (q) {
      visible = visible.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.filePath.toLowerCase().includes(q),
      );
    }

    // Focus: if a node is requested, keep only it + its 1-hop neighbors.
    if (focusRequest) {
      const keep = new Set<string>([focusRequest]);
      for (const e of graph.edges) {
        if (e.source === focusRequest) keep.add(e.target);
        if (e.target === focusRequest) keep.add(e.source);
      }
      visible = graph.nodes.filter((n) => keep.has(n.id));
    }

    const total = visible.length;
    let cappedCount = 0;
    if (visible.length > MAX_RENDER_NODES) {
      cappedCount = total - MAX_RENDER_NODES;
      visible = visible.slice(0, MAX_RENDER_NODES);
    }
    const visibleIds = new Set(visible.map((n) => n.id));

    const flowNodes: RebuildFlowNode[] = visible.map((n) => ({
      id: n.id,
      type: "rebuild" as const,
      position: { x: 0, y: 0 },
      data: {
        label: n.name,
        nodeType: n.type,
        coverage: n.rebuild.coverage,
        priority: n.rebuild.priority,
        selected: false,
      },
    }));

    const flowEdges: Edge[] = graph.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: e.type,
        style: { stroke: "var(--color-edge)", strokeWidth: 1 },
        labelStyle: { fill: "var(--color-text-muted)", fontSize: 9 },
      }));

    return { flowNodes, flowEdges, cappedCount };
  }, [graph, filters, searchQuery, focusRequest]);

  // 2. Run ELK layout (async).
  useEffect(() => {
    if (!built) {
      setLayouted([]);
      setEdges([]);
      setCapped(0);
      return;
    }
    let cancelled = false;
    setCapped(built.cappedCount);
    setEdges(built.flowEdges);
    layoutGraph(built.flowNodes as unknown as Node[], built.flowEdges).then((positioned) => {
      if (!cancelled) setLayouted(positioned);
    });
    return () => {
      cancelled = true;
    };
  }, [built]);

  // Recenter whenever a new layout is rendered (e.g. after a search narrows the
  // graph). A short settle delay lets React Flow MEASURE the new custom-node set
  // before fitting — fitting in the same tick (or after one frame) centers on
  // stale/zero-size bounds, which left the matches tiny in a corner.
  useEffect(() => {
    if (layouted.length === 0) return;
    const t = setTimeout(
      () => fitView({ padding: 0.2, duration: 320, minZoom: 0.05 }),
      160,
    );
    return () => clearTimeout(t);
  }, [layouted, fitView]);

  // 3. Reflect selection into node data without re-layout.
  const nodes = useMemo(
    () =>
      layouted.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedNodeId },
      })),
    [layouted, selectedNodeId],
  );

  return (
    <div className="h-full w-full relative">
      {capped > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-lg bg-surface border border-border-medium text-xs text-text-secondary pointer-events-none">
          Showing first {MAX_RENDER_NODES} nodes — {capped} more hidden. Use search or filters to narrow.
        </div>
      )}
      {focusRequest && (
        <button
          onClick={clearFocusRequest}
          className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs border border-accent/40 hover:bg-accent/30"
        >
          Clear focus
        </button>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => selectNode(n.id)}
        onPaneClick={() => selectNode(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.02 }}
        minZoom={0.02}
        maxZoom={2}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-graph-dots)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--color-minimap-node)"
          maskColor="var(--color-graph-mask)"
          className="!bg-surface !border !border-border-subtle !rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}

export default function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
