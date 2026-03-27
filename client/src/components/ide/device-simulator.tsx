import { ReactNode, useRef, useState, useEffect, useCallback } from "react";
import { type Orientation, type DeviceSpec } from "@/lib/device-specs";

interface DeviceSimulatorProps {
  deviceSpec: DeviceSpec;
  orientation: Orientation;
  frameStyle: "light" | "dark";
  platformOverride?: "ios" | "android";
  children: ReactNode;
}

function IOSStatusBar({ isDark }: { isDark: boolean }) {
  const color = isDark ? "#fff" : "#000";
  return (
    <div className="flex items-center justify-between w-full px-6" style={{ height: 20 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        9:41
      </span>
      <div className="flex items-center gap-1">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <rect x="0" y="6" width="3" height="6" rx="0.5" fill={color} opacity="0.4" />
          <rect x="4" y="4" width="3" height="8" rx="0.5" fill={color} opacity="0.6" />
          <rect x="8" y="2" width="3" height="10" rx="0.5" fill={color} opacity="0.8" />
          <rect x="12" y="0" width="3" height="12" rx="0.5" fill={color} />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
          <path d="M7.5 3.5C9.2 3.5 10.7 4.2 11.8 5.3L13.2 3.9C11.7 2.4 9.7 1.5 7.5 1.5C5.3 1.5 3.3 2.4 1.8 3.9L3.2 5.3C4.3 4.2 5.8 3.5 7.5 3.5Z" fill={color} opacity="0.5" />
          <path d="M7.5 6.5C8.6 6.5 9.6 6.9 10.4 7.7L11.8 6.3C10.6 5.1 9.1 4.5 7.5 4.5C5.9 4.5 4.4 5.1 3.2 6.3L4.6 7.7C5.4 6.9 6.4 6.5 7.5 6.5Z" fill={color} opacity="0.75" />
          <circle cx="7.5" cy="10" r="1.5" fill={color} />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0" y="1" width="21" height="10" rx="2" stroke={color} strokeWidth="1" fill="none" opacity="0.4" />
          <rect x="1.5" y="2.5" width="15" height="7" rx="1" fill={color} />
          <rect x="22" y="4" width="2" height="4" rx="0.5" fill={color} opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function AndroidStatusBar({ isDark }: { isDark: boolean }) {
  const color = isDark ? "#fff" : "#000";
  return (
    <div className="flex items-center justify-between w-full px-4" style={{ height: 20 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color, fontFamily: "'Roboto', system-ui, sans-serif" }}>
        9:41
      </span>
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="0" y="8" width="2.5" height="4" rx="0.5" fill={color} opacity="0.3" />
          <rect x="3.2" y="5.5" width="2.5" height="6.5" rx="0.5" fill={color} opacity="0.5" />
          <rect x="6.4" y="3" width="2.5" height="9" rx="0.5" fill={color} opacity="0.75" />
          <rect x="9.6" y="0" width="2.4" height="12" rx="0.5" fill={color} />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
          <path d="M7.5 3.5C9.2 3.5 10.7 4.2 11.8 5.3L13.2 3.9C11.7 2.4 9.7 1.5 7.5 1.5C5.3 1.5 3.3 2.4 1.8 3.9L3.2 5.3C4.3 4.2 5.8 3.5 7.5 3.5Z" fill={color} opacity="0.5" />
          <path d="M7.5 6.5C8.6 6.5 9.6 6.9 10.4 7.7L11.8 6.3C10.6 5.1 9.1 4.5 7.5 4.5C5.9 4.5 4.4 5.1 3.2 6.3L4.6 7.7C5.4 6.9 6.4 6.5 7.5 6.5Z" fill={color} opacity="0.75" />
          <circle cx="7.5" cy="10" r="1.5" fill={color} />
        </svg>
        <svg width="22" height="12" viewBox="0 0 22 12" fill="none">
          <rect x="0" y="1" width="19" height="10" rx="2" stroke={color} strokeWidth="1" fill="none" opacity="0.4" />
          <rect x="1.5" y="2.5" width="13" height="7" rx="1" fill={color} />
          <rect x="20" y="3.5" width="2" height="5" rx="0.5" fill={color} opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function DynamicIsland({ isDark }: { isDark: boolean }) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2"
      style={{
        top: 10,
        width: 126,
        height: 36,
        borderRadius: 20,
        backgroundColor: isDark ? "#000" : "#1a1a1a",
      }}
    />
  );
}

function IOSHomeIndicator({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 28 }}>
      <div
        style={{
          width: 134,
          height: 5,
          borderRadius: 3,
          backgroundColor: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)",
        }}
      />
    </div>
  );
}

function AndroidNavBar({ isDark }: { isDark: boolean }) {
  const iconColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.35)";
  return (
    <div className="flex items-center justify-center gap-12" style={{ height: 36 }}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <polygon points="14,3 4,9 14,15" fill={iconColor} />
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" fill="none" stroke={iconColor} strokeWidth="2" />
      </svg>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke={iconColor} strokeWidth="2" />
      </svg>
    </div>
  );
}

export function DeviceSimulator({
  deviceSpec,
  orientation,
  frameStyle,
  platformOverride,
  children,
}: DeviceSimulatorProps) {
  const specW = deviceSpec.width;
  const specH = deviceSpec.height;
  const deviceW = orientation === "landscape" ? specH : specW;
  const deviceH = orientation === "landscape" ? specW : specH;
  const platform = platformOverride || deviceSpec.platform;
  const isIOS = platform === "ios";
  const isDark = frameStyle === "dark";

  const hasDI = isIOS && (deviceSpec.hasDynamicIsland ?? false);
  const isIPad = deviceSpec.id === "ipad";

  const bezelRadius = isIPad ? 18 : 40;
  const sideBezel = isIPad ? 16 : 10;

  const statusBarH = 24;
  const topChromeH = isIOS ? (hasDI ? 54 : statusBarH) : statusBarH;
  const bottomChromeH = isIOS ? 28 : 36;

  const totalW = deviceW + sideBezel * 2;
  const totalH = deviceH + topChromeH + bottomChromeH + sideBezel * 2;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const computeScale = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pad = 32;
    const availW = rect.width - pad;
    const availH = rect.height - pad;
    if (availW <= 0 || availH <= 0) return;
    const s = Math.min(availW / totalW, availH / totalH, 1);
    setScale(s);
  }, [totalW, totalH]);

  useEffect(() => {
    computeScale();
    const ro = new ResizeObserver(computeScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [computeScale]);

  const frameBg = isDark ? "#1c1c1e" : "#e8e8ed";
  const frameEdge = isDark ? "#3a3a3c" : "#c7c7cc";
  const screenBg = isDark ? "#000" : "#fff";
  const statusBg = isDark ? "rgba(0,0,0,0.85)" : "rgba(245,245,247,0.9)";

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center w-full h-full overflow-hidden"
      style={{ backgroundColor: isDark ? "#0c0c0e" : "#f0f0f2" }}
      data-testid="device-simulator-container"
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          width: totalW,
          height: totalH,
          flexShrink: 0,
        }}
      >
        <div
          className="relative overflow-hidden"
          style={{
            width: totalW,
            height: totalH,
            borderRadius: bezelRadius,
            backgroundColor: frameBg,
            border: `2px solid ${frameEdge}`,
            boxShadow: isDark
              ? "0 25px 80px rgba(0,0,0,0.9), 0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 25px 80px rgba(0,0,0,0.18), 0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
          }}
          data-testid="device-frame"
        >
          <div
            className="absolute flex flex-col items-center justify-end"
            style={{
              top: sideBezel,
              left: sideBezel,
              right: sideBezel,
              height: topChromeH,
              backgroundColor: statusBg,
              borderRadius: `${Math.max(bezelRadius - sideBezel, 8)}px ${Math.max(bezelRadius - sideBezel, 8)}px 0 0`,
              zIndex: 10,
              paddingBottom: 2,
            }}
          >
            {hasDI && <DynamicIsland isDark={isDark} />}
            {isIOS ? <IOSStatusBar isDark={isDark} /> : <AndroidStatusBar isDark={isDark} />}
          </div>

          <div
            className="absolute overflow-hidden"
            style={{
              top: sideBezel + topChromeH,
              left: sideBezel,
              right: sideBezel,
              bottom: sideBezel + bottomChromeH,
              backgroundColor: screenBg,
              cursor: "pointer",
            }}
            data-testid="device-screen"
          >
            {children}
          </div>

          <div
            className="absolute flex items-center justify-center"
            style={{
              bottom: sideBezel,
              left: sideBezel,
              right: sideBezel,
              height: bottomChromeH,
              backgroundColor: statusBg,
              borderRadius: `0 0 ${Math.max(bezelRadius - sideBezel, 8)}px ${Math.max(bezelRadius - sideBezel, 8)}px`,
              zIndex: 10,
            }}
          >
            {isIOS ? <IOSHomeIndicator isDark={isDark} /> : <AndroidNavBar isDark={isDark} />}
          </div>
        </div>
      </div>
    </div>
  );
}
