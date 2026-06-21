import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { NodeType, CoverageState, RebuildPriority } from "../types";
import { coverageColor, nodeTypeColor, priorityColor } from "../colors";

export interface RebuildNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  coverage: CoverageState;
  priority: RebuildPriority;
  selected: boolean;
}

export type RebuildFlowNode = Node<RebuildNodeData, "rebuild">;

function RebuildNodeView({ data }: NodeProps<RebuildFlowNode>) {
  return (
    <div
      className={`rounded-lg bg-elevated overflow-hidden ${data.selected ? "node-glow" : ""}`}
      style={{
        width: 200,
        border: `1px solid ${data.selected ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
        borderLeft: `4px solid ${nodeTypeColor(data.nodeType)}`,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-text-muted !w-1.5 !h-1.5" />
      <div className="px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: nodeTypeColor(data.nodeType) }}
          >
            {data.nodeType}
          </span>
          {data.priority && (
            <span
              className="text-[8px] font-bold uppercase px-1 rounded"
              style={{
                color: priorityColor(data.priority),
                border: `1px solid ${priorityColor(data.priority)}`,
              }}
            >
              {data.priority}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-primary truncate" title={data.label}>
          {data.label}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: coverageColor(data.coverage) }}
          />
          <span className="text-[8px] text-text-muted">{data.coverage}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-text-muted !w-1.5 !h-1.5" />
    </div>
  );
}

export default memo(RebuildNodeView);
