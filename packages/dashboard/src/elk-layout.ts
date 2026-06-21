import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";

/**
 * Single-stage ELK layered layout (forked from the Understand-Anything dashboard's
 * elk-layout util, simplified — no nested containers). Lays the rebuild graph out
 * left-to-right so dependency-ordered layers read naturally.
 */
const elk = new ELK();

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 56;

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "40",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

export async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): Promise<Node[]> {
  if (nodes.length === 0) return nodes;
  const ids = new Set(nodes.map((n) => n.id));
  const elkEdges = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] }));

  const input = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: elkEdges,
  };

  try {
    const res = (await elk.layout(input as never)) as {
      children?: { id: string; x?: number; y?: number }[];
    };
    const pos = new Map<string, { x: number; y: number }>();
    for (const c of res.children ?? []) {
      pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
    }
    return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
  } catch (err) {
    console.error("[elk] layout failed:", err);
    // Fallback: simple grid so the graph still renders.
    const cols = Math.ceil(Math.sqrt(nodes.length));
    return nodes.map((n, i) => ({
      ...n,
      position: {
        x: (i % cols) * (NODE_WIDTH + 40),
        y: Math.floor(i / cols) * (NODE_HEIGHT + 40),
      },
    }));
  }
}
