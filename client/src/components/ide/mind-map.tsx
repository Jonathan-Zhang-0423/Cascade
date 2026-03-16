import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { NotebookMindMap } from "@/stores/ide-store";
import { ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";

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

const NODE_W_CENTRAL = 180;
const NODE_H_CENTRAL = 44;
const NODE_W_BRANCH = 140;
const NODE_H_BRANCH = 36;
const NODE_W_CHILD = 100;
const NODE_H_CHILD = 30;

function computeLayout(
  data: NotebookMindMap,
  expandedBranches: Set<number>
): { nodes: LayoutNode[]; width: number; height: number } {
  const branches = data.branches || [];
  const totalBranches = branches.length;

  if (totalBranches === 0) {
    return {
      nodes: [{
        x: 400, y: 300,
        label: data.central_node,
        color: { bg: "#E8F5E9", border: "#4CAF50", text: "#1B5E20" },
        isCentral: true,
      }],
      width: 800, height: 600,
    };
  }

  const branchRadius = Math.max(260, totalBranches * 70);
  const childForward = 170;
  const childSep = 125;

  const canvasSize = (branchRadius + childForward + NODE_W_CHILD + 60) * 2 + 100;
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

    const forwX = Math.cos(angle);
    const forwY = Math.sin(angle);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);

    const baseCX = bx + forwX * childForward;
    const baseCY = by + forwY * childForward;

    const mid = (childCount - 1) / 2;

    children.forEach((child, ci) => {
      const offset = (ci - mid) * childSep;
      const cx = baseCX + perpX * offset;
      const cy = baseCY + perpY * offset;

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

  const padding = 120;
  const minX = Math.min(...allNodes.map((n) => n.x)) - padding;
  const minY = Math.min(...allNodes.map((n) => n.y)) - padding;
  const maxX = Math.max(...allNodes.map((n) => n.x)) + padding;
  const maxY = Math.max(...allNodes.map((n) => n.y)) + padding;

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
    width: maxX - minX,
    height: maxY - minY,
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
  const boxWidth = 240;
  const boxHeight = 78;
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

interface Transform {
  panX: number;
  panY: number;
  scale: number;
}

export function MindMap({ data }: MindMapProps) {
  const [expandedBranches, setExpandedBranches] = useState<Set<number>>(new Set());
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transform, setTransform] = useState<Transform>({ panX: 0, panY: 0, scale: 1 });
  const [draggingCursor, setDraggingCursor] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panAtDragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const { nodes, width, height } = useMemo(
    () => computeLayout(data, expandedBranches),
    [data, expandedBranches]
  );

  const recalculate = useCallback((ref: HTMLDivElement | null) => {
    if (!ref) return;
    const cw = ref.clientWidth || 700;
    const ch = ref.clientHeight || 500;
    const s = Math.min(0.95, Math.min(cw / width, ch / height));
    const panX = (cw - width * s) / 2;
    const panY = (ch - height * s) / 2;
    setTransform({ panX, panY, scale: s });
  }, [width, height]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      recalculate(isFullscreen ? fullscreenRef.current : containerRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [width, height, isFullscreen, recalculate]);

  useEffect(() => {
    const container = isFullscreen ? fullscreenRef.current : containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY < 0 ? 1.08 : 0.93;
        setTransform((prev) => {
          const newScale = Math.min(4, Math.max(0.15, prev.scale * delta));
          const ratio = newScale / prev.scale;
          return {
            scale: newScale,
            panX: mouseX - (mouseX - prev.panX) * ratio,
            panY: mouseY - (mouseY - prev.panY) * ratio,
          };
        });
      } else {
        setTransform((prev) => ({
          ...prev,
          panX: prev.panX - e.deltaX,
          panY: prev.panY - e.deltaY,
        }));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panAtDragStart.current = { x: transform.panX, y: transform.panY };
    setDraggingCursor(true);
  }, [transform.panX, transform.panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!hasMoved.current && Math.abs(dx) + Math.abs(dy) > 4) {
      hasMoved.current = true;
    }
    setTransform((prev) => ({
      ...prev,
      panX: panAtDragStart.current.x + dx,
      panY: panAtDragStart.current.y + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    setDraggingCursor(false);
  }, []);

  const zoomIn = useCallback(() => {
    const container = isFullscreen ? fullscreenRef.current : containerRef.current;
    const cw = container ? container.clientWidth / 2 : 350;
    const ch = container ? container.clientHeight / 2 : 250;
    setTransform((prev) => {
      const newScale = Math.min(4, prev.scale * 1.25);
      const ratio = newScale / prev.scale;
      return { scale: newScale, panX: cw - (cw - prev.panX) * ratio, panY: ch - (ch - prev.panY) * ratio };
    });
  }, [isFullscreen]);

  const zoomOut = useCallback(() => {
    const container = isFullscreen ? fullscreenRef.current : containerRef.current;
    const cw = container ? container.clientWidth / 2 : 350;
    const ch = container ? container.clientHeight / 2 : 250;
    setTransform((prev) => {
      const newScale = Math.max(0.15, prev.scale * 0.8);
      const ratio = newScale / prev.scale;
      return { scale: newScale, panX: cw - (cw - prev.panX) * ratio, panY: ch - (ch - prev.panY) * ratio };
    });
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const toggleBranch = useCallback((bi: number) => {
    if (hasMoved.current) return;
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
    if (hasMoved.current) return;
    setPinnedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const svgContent = (
    <>
      {nodes.map((node, i) => {
        if (node.parentX !== undefined && node.parentY !== undefined) {
          const mx = (node.parentX + node.x) / 2;
          const my = (node.parentY + node.y) / 2;
          return (
            <path
              key={`line-${i}`}
              d={`M ${node.parentX} ${node.parentY} Q ${mx + (node.y - node.parentY) * 0.12} ${my - (node.x - node.parentX) * 0.12}, ${node.x} ${node.y}`}
              fill="none"
              stroke={node.color.border}
              strokeWidth={node.isBranch ? 2.5 : 1.5}
              strokeOpacity={node.isBranch ? 0.55 : 0.3}
            />
          );
        }
        return null;
      })}

      {nodes.map((node) => {
        if (node.isCentral) {
          return (
            <g key="node-central" data-testid="mind-map-node-central">
              <rect
                x={node.x - NODE_W_CENTRAL / 2}
                y={node.y - NODE_H_CENTRAL / 2}
                width={NODE_W_CENTRAL}
                height={NODE_H_CENTRAL}
                rx={22}
                fill={node.color.bg}
                stroke={node.color.border}
                strokeWidth={2.5}
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
                {node.label.length > 20 ? node.label.slice(0, 18) + "…" : node.label}
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
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => toggleBranch(node.branchIndex!)}
              style={{ cursor: "pointer" }}
              data-testid={`mind-map-branch-${node.branchIndex}`}
            >
              <rect
                x={node.x - NODE_W_BRANCH / 2}
                y={node.y - NODE_H_BRANCH / 2}
                width={NODE_W_BRANCH}
                height={NODE_H_BRANCH}
                rx={18}
                fill={node.color.bg}
                stroke={node.color.border}
                strokeWidth={isHovered || isExpanded ? 3 : 2}
              />
              {isExpanded && (
                <circle
                  cx={node.x + NODE_W_BRANCH / 2 - 12}
                  cy={node.y}
                  r={4}
                  fill={node.color.border}
                  opacity={0.7}
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
                {node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label}
              </text>
              {isHovered && node.description && (
                <TooltipBox
                  x={node.x}
                  y={node.y}
                  nodeHeight={NODE_H_BRANCH}
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
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => togglePin(childKey)}
              style={{ cursor: node.explanation ? "pointer" : "default" }}
              data-testid={`mind-map-child-${node.branchIndex}-${node.childIndex}`}
            >
              <rect
                x={node.x - NODE_W_CHILD / 2}
                y={node.y - NODE_H_CHILD / 2}
                width={NODE_W_CHILD}
                height={NODE_H_CHILD}
                rx={15}
                fill={node.color.bg}
                stroke={node.color.border}
                strokeWidth={isHovered || isPinned ? 2.5 : 1.5}
              />
              {isPinned && (
                <circle
                  cx={node.x + NODE_W_CHILD / 2 - 8}
                  cy={node.y - NODE_H_CHILD / 2 + 8}
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
                {node.label.length > 14 ? node.label.slice(0, 12) + "…" : node.label}
              </text>
              {showTooltip && (
                <TooltipBox
                  x={node.x}
                  y={node.y}
                  nodeHeight={NODE_H_CHILD}
                  text={node.explanation!}
                  borderColor={node.color.border}
                />
              )}
            </g>
          );
        }

        return null;
      })}
    </>
  );

  const controls = (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
      <button
        onClick={zoomIn}
        className="w-7 h-7 rounded-md bg-background/90 border border-border shadow flex items-center justify-center text-foreground hover:bg-muted transition-colors"
        title="Zoom in"
        data-testid="button-mindmap-zoomin"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={zoomOut}
        className="w-7 h-7 rounded-md bg-background/90 border border-border shadow flex items-center justify-center text-foreground hover:bg-muted transition-colors"
        title="Zoom out"
        data-testid="button-mindmap-zoomout"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={toggleFullscreen}
        className="w-7 h-7 rounded-md bg-background/90 border border-border shadow flex items-center justify-center text-foreground hover:bg-muted transition-colors"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        data-testid="button-mindmap-fullscreen"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isFullscreen ? <X className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  const hint = (
    <div
      className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-background/70 px-2 py-1 rounded-md"
      style={{ pointerEvents: "none" }}
    >
      拖拽移动 · 双指/Ctrl+滚轮缩放
    </div>
  );

  const dotGrid = (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        pointerEvents: "none",
      }}
    />
  );

  const svgElement = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`,
        transformOrigin: "0 0",
        overflow: "visible",
      }}
    >
      {svgContent}
    </svg>
  );

  const canvasDiv = (
    divRef: React.RefObject<HTMLDivElement>,
    extraClass = ""
  ) => (
    <div
      ref={divRef}
      className={`relative w-full h-full rounded-xl border border-border overflow-hidden bg-muted/20 select-none ${extraClass}`}
      style={{ cursor: draggingCursor ? "grabbing" : "grab" }}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      data-testid="mind-map-container"
    >
      {dotGrid}
      {svgElement}
      {controls}
      {hint}
    </div>
  );

  return (
    <>
      <div style={{ height: 500 }}>
        {!isFullscreen && canvasDiv(containerRef)}
      </div>

      {isFullscreen && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-black/60"
            onClick={toggleFullscreen}
          />
          <div className="fixed inset-4 z-[9999]">
            {canvasDiv(fullscreenRef)}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
