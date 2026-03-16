import { useState, useMemo, useCallback } from "react";
import type { NotebookMindMap, NotebookMindMapBranch } from "@/stores/ide-store";

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
  description?: string;
  explanation?: string;
  color: { bg: string; border: string; text: string };
  isCentral?: boolean;
  isBranch?: boolean;
  isChild?: boolean;
  file?: string;
  branchIndex?: number;
  childIndex?: number;
  parentX?: number;
  parentY?: number;
}

function computeLayout(
  data: NotebookMindMap,
  expandedBranches: Set<number>
): { nodes: LayoutNode[]; width: number; height: number } {
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
      description: branch.description,
      file: branch.file,
      color: fileColor,
      isBranch: true,
      branchIndex: bi,
      parentX: centerX,
      parentY: centerY,
    });

    if (!expandedBranches.has(bi)) return;

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
        isChild: true,
        branchIndex: bi,
        childIndex: ci,
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

function TooltipBox({
  x,
  y,
  nodeHeight,
  text,
  borderColor,
}: {
  x: number;
  y: number;
  nodeHeight: number;
  text: string;
  borderColor: string;
}) {
  const boxWidth = 260;
  const boxHeight = 80;
  const boxX = x - boxWidth / 2;
  const boxY = y + nodeHeight / 2 + 10;

  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx={8}
        fill="white"
        stroke={borderColor}
        strokeWidth={1.5}
        filter="drop-shadow(0 2px 8px rgba(0,0,0,0.15))"
      />
      <foreignObject
        x={boxX + 10}
        y={boxY + 8}
        width={boxWidth - 20}
        height={boxHeight - 16}
      >
        <div
          style={{
            fontSize: "11px",
            lineHeight: "1.4",
            color: "#333",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
          }}
        >
          {text}
        </div>
      </foreignObject>
    </g>
  );
}

export function MindMap({ data }: MindMapProps) {
  const [expandedBranches, setExpandedBranches] = useState<Set<number>>(new Set());
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());

  const toggleBranch = useCallback((bi: number) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(bi)) {
        next.delete(bi);
        setPinnedNodes((pp) => {
          const np = new Set(pp);
          Array.from(pp).forEach((key) => {
            if (key.startsWith(`child-${bi}-`)) np.delete(key);
          });
          return np;
        });
      } else {
        next.add(bi);
      }
      return next;
    });
  }, []);

  const togglePin = useCallback((key: string) => {
    setPinnedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const { nodes, width, height } = useMemo(
    () => computeLayout(data, expandedBranches),
    [data, expandedBranches]
  );

  return (
    <div className="w-full overflow-x-auto" data-testid="mind-map-container">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[500px]"
        style={{ maxHeight: "600px" }}
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
          const nodeWidth = node.isCentral ? 180 : node.isBranch ? 140 : 120;
          const nodeHeight = node.isCentral ? 44 : node.isBranch ? 36 : 30;
          const rx = node.isCentral ? 22 : node.isBranch ? 18 : 15;

          if (node.isCentral) {
            return (
              <g key={`node-central`} data-testid="mind-map-node-central">
                <rect
                  x={node.x - nodeWidth / 2}
                  y={node.y - nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={rx}
                  fill={node.color.bg}
                  stroke={node.color.border}
                  strokeWidth={2.5}
                  opacity={0.9}
                />
                <text
                  x={node.x}
                  y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={node.color.text}
                  fontSize={13}
                  fontWeight={700}
                  style={{ pointerEvents: "none" }}
                >
                  {node.label.length > 18 ? node.label.slice(0, 16) + "..." : node.label}
                </text>
              </g>
            );
          }

          if (node.isBranch) {
            const branchKey = `branch-${node.branchIndex}`;
            const isHovered = hoveredNode === branchKey;
            const isExpanded = expandedBranches.has(node.branchIndex!);

            return (
              <g
                key={branchKey}
                onMouseEnter={() => setHoveredNode(branchKey)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => toggleBranch(node.branchIndex!)}
                style={{ cursor: "pointer" }}
                data-testid={`mind-map-branch-${node.branchIndex}`}
              >
                <rect
                  x={node.x - nodeWidth / 2}
                  y={node.y - nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={rx}
                  fill={node.color.bg}
                  stroke={node.color.border}
                  strokeWidth={isHovered || isExpanded ? 3 : 2}
                  opacity={isHovered ? 1 : 0.9}
                />
                {isExpanded && (
                  <circle
                    cx={node.x + nodeWidth / 2 - 12}
                    cy={node.y}
                    r={4}
                    fill={node.color.border}
                    opacity={0.6}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <text
                  x={node.x}
                  y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={node.color.text}
                  fontSize={11}
                  fontWeight={600}
                  style={{ pointerEvents: "none" }}
                >
                  {node.label.length > 18 ? node.label.slice(0, 16) + "..." : node.label}
                </text>

                {isHovered && node.description && (
                  <TooltipBox
                    x={node.x}
                    y={node.y}
                    nodeHeight={nodeHeight}
                    text={node.description}
                    borderColor={node.color.border}
                  />
                )}
              </g>
            );
          }

          if (node.isChild) {
            const childKey = `child-${node.branchIndex}-${node.childIndex}`;
            const isHovered = hoveredNode === childKey;
            const isPinned = pinnedNodes.has(childKey);
            const showTooltip = (isHovered || isPinned) && node.explanation;

            return (
              <g
                key={childKey}
                onMouseEnter={() => setHoveredNode(childKey)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(childKey);
                }}
                style={{ cursor: node.explanation ? "pointer" : "default" }}
                data-testid={`mind-map-child-${node.branchIndex}-${node.childIndex}`}
              >
                <rect
                  x={node.x - nodeWidth / 2}
                  y={node.y - nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={rx}
                  fill={node.color.bg}
                  stroke={node.color.border}
                  strokeWidth={isHovered || isPinned ? 2.5 : 1.5}
                  opacity={isHovered ? 1 : 0.9}
                />
                {isPinned && (
                  <circle
                    cx={node.x + nodeWidth / 2 - 8}
                    cy={node.y - nodeHeight / 2 + 8}
                    r={3}
                    fill={node.color.border}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <text
                  x={node.x}
                  y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={node.color.text}
                  fontSize={10}
                  fontWeight={500}
                  style={{ pointerEvents: "none" }}
                >
                  {node.label.length > 16 ? node.label.slice(0, 14) + "..." : node.label}
                </text>

                {showTooltip && (
                  <TooltipBox
                    x={node.x}
                    y={node.y}
                    nodeHeight={nodeHeight}
                    text={node.explanation!}
                    borderColor={node.color.border}
                  />
                )}
              </g>
            );
          }

          return null;
        })}
      </svg>
    </div>
  );
}
