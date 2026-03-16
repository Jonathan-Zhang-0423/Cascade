import { useState, useMemo } from "react";
import type { NotebookMindMap } from "@/stores/ide-store";

interface MindMapProps {
  data: NotebookMindMap;
}

const FILE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  html: { bg: "#FFF3E0", border: "#FF9800", text: "#E65100" },
  css: { bg: "#E3F2FD", border: "#2196F3", text: "#0D47A1" },
  js: { bg: "#FFFDE7", border: "#FFC107", text: "#F57F17" },
  ts: { bg: "#E8EAF6", border: "#3F51B5", text: "#1A237E" },
  json: { bg: "#F3E5F5", border: "#9C27B0", text: "#4A148C" },
  default: { bg: "#F5F5F5", border: "#9E9E9E", text: "#424242" },
};

function getFileColor(file: string) {
  const ext = file.split(".").pop()?.toLowerCase() || "";
  return FILE_COLORS[ext] || FILE_COLORS.default;
}

function getFileName(file: string) {
  return file.split("/").pop() || file;
}

interface LayoutNode {
  x: number;
  y: number;
  label: string;
  explanation?: string;
  color: { bg: string; border: string; text: string };
  isCentral?: boolean;
  file?: string;
  children?: LayoutNode[];
  parentX?: number;
  parentY?: number;
}

function computeLayout(data: NotebookMindMap): { nodes: LayoutNode[]; width: number; height: number } {
  const centerX = 400;
  const centerY = 60;
  const branchSpacingY = 180;
  const childSpacingX = 160;

  const allNodes: LayoutNode[] = [];

  const centralNode: LayoutNode = {
    x: centerX,
    y: centerY,
    label: data.central_node,
    color: { bg: "#E8F5E9", border: "#4CAF50", text: "#1B5E20" },
    isCentral: true,
  };
  allNodes.push(centralNode);

  const branches = data.branches || [];
  const totalBranches = branches.length;

  branches.forEach((branch, bi) => {
    const branchY = centerY + 120 + bi * branchSpacingY;
    const fileColor = getFileColor(branch.file || "");

    const branchStartX = centerX - ((branch.children?.length || 1) - 1) * (childSpacingX / 2);

    const branchNode: LayoutNode = {
      x: centerX,
      y: branchY,
      label: branch.label || getFileName(branch.file),
      file: branch.file,
      color: fileColor,
      parentX: centralNode.x,
      parentY: centralNode.y,
      children: [],
    };
    allNodes.push(branchNode);

    (branch.children || []).forEach((child, ci) => {
      const childX = branchStartX + ci * childSpacingX;
      const childY = branchY + 90;

      const childNode: LayoutNode = {
        x: childX,
        y: childY,
        label: child.label,
        explanation: child.explanation,
        color: fileColor,
        parentX: branchNode.x,
        parentY: branchNode.y,
      };
      allNodes.push(childNode);
    });
  });

  const maxX = Math.max(...allNodes.map((n) => n.x)) + 120;
  const maxY = Math.max(...allNodes.map((n) => n.y)) + 80;

  return { nodes: allNodes, width: Math.max(maxX, 800), height: Math.max(maxY, 400) };
}

export function MindMap({ data }: MindMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, width, height } = useMemo(() => computeLayout(data), [data]);

  return (
    <div className="w-full overflow-x-auto" data-testid="mind-map-container">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[600px]"
        style={{ maxHeight: "500px" }}
      >
        {nodes.map((node, i) => {
          if (node.parentX !== undefined && node.parentY !== undefined) {
            const midY = (node.parentY + node.y) / 2;
            return (
              <path
                key={`line-${i}`}
                d={`M ${node.parentX} ${node.parentY + 20} C ${node.parentX} ${midY}, ${node.x} ${midY}, ${node.x} ${node.y - 20}`}
                fill="none"
                stroke={node.color.border}
                strokeWidth="2"
                strokeOpacity="0.4"
              />
            );
          }
          return null;
        })}

        {nodes.map((node, i) => {
          const nodeKey = `${node.label}-${i}`;
          const isHovered = hoveredNode === nodeKey;
          const isSelected = selectedNode === nodeKey;
          const nodeWidth = node.isCentral ? 200 : 140;
          const nodeHeight = node.isCentral ? 44 : 36;
          const rx = node.isCentral ? 22 : 18;

          return (
            <g
              key={nodeKey}
              onMouseEnter={() => setHoveredNode(nodeKey)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setSelectedNode(isSelected ? null : nodeKey)}
              style={{ cursor: node.explanation ? "pointer" : "default" }}
              data-testid={`mind-map-node-${i}`}
            >
              <rect
                x={node.x - nodeWidth / 2}
                y={node.y - nodeHeight / 2}
                width={nodeWidth}
                height={nodeHeight}
                rx={rx}
                fill={node.color.bg}
                stroke={node.color.border}
                strokeWidth={isHovered || isSelected ? 3 : 2}
                opacity={isHovered ? 1 : 0.9}
              />
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={node.color.text}
                fontSize={node.isCentral ? 14 : 11}
                fontWeight={node.isCentral ? 700 : 500}
                style={{ pointerEvents: "none" }}
              >
                {node.label.length > 18 ? node.label.slice(0, 16) + "..." : node.label}
              </text>

              {isSelected && node.explanation && (
                <g>
                  <rect
                    x={node.x - 120}
                    y={node.y + nodeHeight / 2 + 8}
                    width={240}
                    height={60}
                    rx={8}
                    fill="white"
                    stroke={node.color.border}
                    strokeWidth={1}
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
                  />
                  <foreignObject
                    x={node.x - 112}
                    y={node.y + nodeHeight / 2 + 14}
                    width={224}
                    height={48}
                  >
                    <div
                      style={{
                        fontSize: "10px",
                        lineHeight: "1.3",
                        color: "#333",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {node.explanation}
                    </div>
                  </foreignObject>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
