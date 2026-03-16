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
  isBranch?: boolean;
  file?: string;
  parentX?: number;
  parentY?: number;
}

function computeLayout(data: NotebookMindMap): { nodes: LayoutNode[]; width: number; height: number } {
  const branches = data.branches || [];
  const totalBranches = branches.length;

  if (totalBranches === 0) {
    return {
      nodes: [{
        x: 400, y: 200,
        label: data.central_node,
        color: { bg: "#E8F5E9", border: "#4CAF50", text: "#1B5E20" },
        isCentral: true,
      }],
      width: 800, height: 400,
    };
  }

  const branchRadius = 180;
  const childRadius = 120;

  const maxChildren = Math.max(...branches.map((b) => b.children?.length || 0), 1);
  const estimatedSpan = branchRadius + childRadius + 100;
  const canvasSize = Math.max(estimatedSpan * 2 + 80, 600);
  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;

  const allNodes: LayoutNode[] = [];

  allNodes.push({
    x: centerX,
    y: centerY,
    label: data.central_node,
    color: { bg: "#E8F5E9", border: "#4CAF50", text: "#1B5E20" },
    isCentral: true,
  });

  const startAngle = -Math.PI / 2;
  const angleStep = (2 * Math.PI) / totalBranches;

  branches.forEach((branch, bi) => {
    const angle = startAngle + bi * angleStep;
    const bx = centerX + Math.cos(angle) * branchRadius;
    const by = centerY + Math.sin(angle) * branchRadius;
    const fileColor = getFileColor(branch.file || "");

    allNodes.push({
      x: bx,
      y: by,
      label: branch.label || getFileName(branch.file),
      file: branch.file,
      color: fileColor,
      isBranch: true,
      parentX: centerX,
      parentY: centerY,
    });

    const children = branch.children || [];
    const childCount = children.length;
    if (childCount === 0) return;

    const childSpreadAngle = Math.min(Math.PI / 3, (Math.PI / 2) / Math.max(totalBranches - 1, 1));
    const childStartAngle = angle - (childSpreadAngle * (childCount - 1)) / 2;

    children.forEach((child, ci) => {
      const cAngle = childCount === 1 ? angle : childStartAngle + ci * childSpreadAngle;
      const cx = bx + Math.cos(cAngle) * childRadius;
      const cy = by + Math.sin(cAngle) * childRadius;

      allNodes.push({
        x: cx,
        y: cy,
        label: child.label,
        explanation: child.explanation,
        color: fileColor,
        parentX: bx,
        parentY: by,
      });
    });
  });

  const minX = Math.min(...allNodes.map((n) => n.x)) - 130;
  const minY = Math.min(...allNodes.map((n) => n.y)) - 50;
  const maxX = Math.max(...allNodes.map((n) => n.x)) + 130;
  const maxY = Math.max(...allNodes.map((n) => n.y)) + 50;

  const offsetX = -minX;
  const offsetY = -minY;
  for (const n of allNodes) {
    n.x += offsetX;
    n.y += offsetY;
    if (n.parentX !== undefined) n.parentX += offsetX;
    if (n.parentY !== undefined) n.parentY += offsetY;
  }

  return {
    nodes: allNodes,
    width: Math.max(maxX - minX, 600),
    height: Math.max(maxY - minY, 400),
  };
}

export function MindMap({ data }: MindMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { nodes, width, height } = useMemo(() => computeLayout(data), [data]);

  return (
    <div className="w-full overflow-x-auto" data-testid="mind-map-container">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[500px]"
        style={{ maxHeight: "550px" }}
      >
        {nodes.map((node, i) => {
          if (node.parentX !== undefined && node.parentY !== undefined) {
            const mx = (node.parentX + node.x) / 2;
            const my = (node.parentY + node.y) / 2;
            return (
              <path
                key={`line-${i}`}
                d={`M ${node.parentX} ${node.parentY} Q ${mx + (node.y - node.parentY) * 0.15} ${my - (node.x - node.parentX) * 0.15}, ${node.x} ${node.y}`}
                fill="none"
                stroke={node.color.border}
                strokeWidth={node.isBranch ? 2.5 : 1.5}
                strokeOpacity={node.isBranch ? 0.6 : 0.35}
              />
            );
          }
          return null;
        })}

        {nodes.map((node, i) => {
          const nodeKey = `${node.label}-${i}`;
          const isHovered = hoveredNode === nodeKey;
          const isSelected = selectedNode === nodeKey;
          const nodeWidth = node.isCentral ? 180 : node.isBranch ? 140 : 120;
          const nodeHeight = node.isCentral ? 44 : node.isBranch ? 36 : 30;
          const rx = node.isCentral ? 22 : node.isBranch ? 18 : 15;

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
                strokeWidth={isHovered || isSelected ? 3 : node.isCentral ? 2.5 : 2}
                opacity={isHovered ? 1 : 0.9}
              />
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={node.color.text}
                fontSize={node.isCentral ? 13 : node.isBranch ? 11 : 10}
                fontWeight={node.isCentral ? 700 : node.isBranch ? 600 : 500}
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
