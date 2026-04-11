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
    <div className="flex items-center justify-between w-full px-7" style={{ height: 22 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color, fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif", letterSpacing: 0.2 }}>
        9:41
      </span>
      <div className="flex items-center gap-[5px]">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
          <rect x="0.5" y="6" width="3" height="6" rx="1" fill={color} opacity="0.35" />
          <rect x="4.5" y="4" width="3" height="8" rx="1" fill={color} opacity="0.55" />
          <rect x="8.5" y="2" width="3" height="10" rx="1" fill={color} opacity="0.75" />
          <rect x="12.5" y="0" width="3" height="12" rx="1" fill={color} />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 3.5C9.6 3.5 11 4.1 12.1 5.2L13.5 3.8C12 2.3 10.1 1.5 8 1.5C5.9 1.5 4 2.3 2.5 3.8L3.9 5.2C5 4.1 6.4 3.5 8 3.5Z" fill={color} opacity="0.45" />
          <path d="M8 6.5C9 6.5 9.9 6.9 10.6 7.6L12 6.2C10.9 5.1 9.5 4.5 8 4.5C6.5 4.5 5.1 5.1 4 6.2L5.4 7.6C6.1 6.9 7 6.5 8 6.5Z" fill={color} opacity="0.7" />
          <circle cx="8" cy="10" r="1.5" fill={color} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="1" width="22" height="11" rx="3.5" stroke={color} strokeWidth="1" fill="none" opacity="0.35" />
          <rect x="2" y="2.5" width="16" height="8" rx="2" fill={color} />
          <path d="M24 4.5C24.8 4.8 25.5 5.7 25.5 6.5C25.5 7.3 24.8 8.2 24 8.5V4.5Z" fill={color} opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function AndroidStatusBar({ isDark }: { isDark: boolean }) {
  const color = isDark ? "#fff" : "#000";
  return (
    <div className="flex items-center justify-between w-full px-5" style={{ height: 22 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color, fontFamily: "'Roboto', system-ui, sans-serif" }}>
        9:41
      </span>
      <div className="flex items-center gap-[5px]">
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
          <rect x="0" y="8" width="2.5" height="4" rx="0.5" fill={color} opacity="0.3" />
          <rect x="3.5" y="5.5" width="2.5" height="6.5" rx="0.5" fill={color} opacity="0.5" />
          <rect x="7" y="3" width="2.5" height="9" rx="0.5" fill={color} opacity="0.75" />
          <rect x="10.5" y="0" width="2.5" height="12" rx="0.5" fill={color} />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 3.5C9.6 3.5 11 4.1 12.1 5.2L13.5 3.8C12 2.3 10.1 1.5 8 1.5C5.9 1.5 4 2.3 2.5 3.8L3.9 5.2C5 4.1 6.4 3.5 8 3.5Z" fill={color} opacity="0.45" />
          <path d="M8 6.5C9 6.5 9.9 6.9 10.6 7.6L12 6.2C10.9 5.1 9.5 4.5 8 4.5C6.5 4.5 5.1 5.1 4 6.2L5.4 7.6C6.1 6.9 7 6.5 8 6.5Z" fill={color} opacity="0.7" />
          <circle cx="8" cy="10" r="1.5" fill={color} />
        </svg>
        <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
          <rect x="0" y="1" width="20" height="10" rx="2.5" stroke={color} strokeWidth="1" fill="none" opacity="0.35" />
          <rect x="1.5" y="2.5" width="14" height="7" rx="1.5" fill={color} />
          <rect x="21" y="3.5" width="2" height="5" rx="0.5" fill={color} opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function DynamicIsland() {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2"
      style={{
        top: 12,
        width: 126,
        height: 37,
        borderRadius: 22,
        backgroundColor: "#000",
        boxShadow: "0 0 0 0.5px rgba(0,0,0,0.3)",
      }}
    />
  );
}

function ClassicNotch({ width }: { width: number }) {
  const notchW = Math.min(width * 0.42, 170);
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ width: notchW, height: 30 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${notchW} 30`} preserveAspectRatio="none">
        <path
          d={`M0,0 L${notchW * 0.08},0 Q${notchW * 0.12},0 ${notchW * 0.14},8 L${notchW * 0.14},18 Q${notchW * 0.14},30 ${notchW * 0.24},30 L${notchW * 0.76},30 Q${notchW * 0.86},30 ${notchW * 0.86},18 L${notchW * 0.86},8 Q${notchW * 0.88},0 ${notchW * 0.92},0 L${notchW},0`}
          fill="#000"
        />
      </svg>
      <div
        className="absolute rounded-full"
        style={{ top: 9, left: "50%", transform: "translateX(-50%)", width: 12, height: 12, backgroundColor: "#1a1a2e", border: "1.5px solid #2a2a3e" }}
      />
      <div
        className="absolute rounded-full"
        style={{ top: 12, left: "50%", transform: "translateX(12px)", width: 6, height: 6, backgroundColor: "#222" }}
      />
    </div>
  );
}

function ClassicHomeButton() {
  return (
    <div className="flex items-center justify-center" style={{ height: 50 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          border: "2.5px solid rgba(255,255,255,0.12)",
          backgroundColor: "transparent",
        }}
      />
    </div>
  );
}

function IOSHomeIndicator({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 30, paddingBottom: 6 }}>
      <div
        style={{
          width: 134,
          height: 5,
          borderRadius: 2,
          background: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.15)",
        }}
      />
    </div>
  );
}

function AndroidNavBar({ isDark }: { isDark: boolean }) {
  const iconColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.3)";
  return (
    <div className="flex items-center justify-center gap-14" style={{ height: 40 }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <polygon points="12,2 4,8 12,14" fill={iconColor} />
      </svg>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" fill="none" stroke={iconColor} strokeWidth="1.8" />
      </svg>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke={iconColor} strokeWidth="1.8" />
      </svg>
    </div>
  );
}

type DeviceVariant = "dynamic-island" | "classic-notch" | "flat";

function getDeviceVariant(spec: DeviceSpec, isIOS: boolean): DeviceVariant {
  if (!isIOS) return "flat";
  if (spec.hasDynamicIsland) return "dynamic-island";
  if (spec.id === "ipad") return "flat";
  return "classic-notch";
}

function SideButtons({ isDark, height, isIOS }: { isDark: boolean; height: number; isIOS: boolean }) {
  const btnColor = isDark ? "#38383e" : "#b0b0b4";
  const btnBorder = isDark ? "#38383e" : "#9a9a9e";
  if (!isIOS) return null;

  return (
    <>
      <div
        className="absolute"
        style={{
          right: -2,
          top: height * 0.18,
          width: 2,
          height: 70,
          background: btnColor,
          borderRadius: "0 2px 2px 0",
          border: `0.5px solid ${btnBorder}`,
          borderLeft: "none",
        }}
      />
      <div
        className="absolute"
        style={{
          left: -2,
          top: height * 0.16,
          width: 2,
          height: 32,
          background: btnColor,
          borderRadius: "2px 0 0 2px",
          border: `0.5px solid ${btnBorder}`,
          borderRight: "none",
        }}
      />
      <div
        className="absolute"
        style={{
          left: -2,
          top: height * 0.24,
          width: 2,
          height: 52,
          background: btnColor,
          borderRadius: "2px 0 0 2px",
          border: `0.5px solid ${btnBorder}`,
          borderRight: "none",
        }}
      />
      <div
        className="absolute"
        style={{
          left: -2,
          top: height * 0.32,
          width: 2,
          height: 52,
          background: btnColor,
          borderRadius: "2px 0 0 2px",
          border: `0.5px solid ${btnBorder}`,
          borderRight: "none",
        }}
      />
    </>
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

  const variant = getDeviceVariant(deviceSpec, isIOS);
  const isIPad = deviceSpec.id === "ipad";
  const isClassicNotch = variant === "classic-notch";
  const hasDI = variant === "dynamic-island";
  const isSE = deviceSpec.id === "iphone-se";

  const sideBezel = isIPad ? 18 : isSE ? 14 : 12;
  const topBezel = isIPad ? 18 : isSE ? 60 : 12;
  const bottomBezel = isIPad ? 18 : isSE ? 70 : 12;
  const specScreenR = deviceSpec.screenRadius ?? (isIPad ? 18 : isSE ? 0 : 55);
  const outerRadius = isIPad ? 24 : isSE ? 12 : Math.min(specScreenR + sideBezel, 58);
  const innerRadius = isIPad ? 8 : isSE ? 0 : specScreenR;

  const totalW = deviceW + sideBezel * 2;
  const totalH = deviceH + topBezel + bottomBezel;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const computeScale = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pad = 40;
    const availW = rect.width - pad;
    const availH = rect.height - pad;
    if (availW <= 0 || availH <= 0) return;
    const s = Math.min(availW / (totalW + 8), availH / (totalH + 8), 1);
    setScale(s);
  }, [totalW, totalH]);

  useEffect(() => {
    computeScale();
    const ro = new ResizeObserver(computeScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [computeScale]);

  const frameBg = isDark ? undefined : "#e0e0e4";
  const frameGradient = isDark ? "linear-gradient(160deg, #2a2a30, #0d0d10)" : undefined;
  const frameEdge = isDark ? "#383840" : "#bbbbc0";

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center w-full h-full overflow-hidden"
      style={{ backgroundColor: isDark ? "#0a0a0c" : "#f0f0f2" }}
      data-testid="device-simulator-container"
    >
      <div
        style={{
          zoom: scale,
          width: totalW + 8,
          height: totalH + 8,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="relative"
          style={{
            width: totalW,
            height: totalH,
            borderRadius: outerRadius,
            background: frameGradient || frameBg,
            border: isDark ? "1.5px solid #383840" : `2.5px solid ${frameEdge}`,
            boxShadow: isDark
              ? `0 4px 24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)`
              : `0 2px 12px rgba(0,0,0,0.15), 0 30px 90px rgba(0,0,0,0.2), 0 8px 30px rgba(0,0,0,0.1), inset 0 0.5px 0 rgba(255,255,255,0.9), inset 0 -0.5px 0 rgba(0,0,0,0.05)`,
            transition: "width 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.35s ease",
          }}
          data-testid="device-frame"
        >
          <SideButtons isDark={isDark} height={totalH} isIOS={isIOS && !isIPad} />

          <div
            className="absolute overflow-hidden"
            style={{
              top: topBezel,
              left: sideBezel,
              right: sideBezel,
              bottom: bottomBezel,
              borderRadius: innerRadius,
              backgroundColor: isDark ? "#000" : "#fff",
            }}
            data-testid="device-screen"
          >
            <div
              className="absolute inset-0 flex flex-col"
              style={{ zIndex: 20, pointerEvents: "none" }}
            >
              {hasDI && <DynamicIsland />}
              {isClassicNotch && <ClassicNotch width={deviceW} />}

              <div style={{ pointerEvents: "none" }}>
                {isIOS ? <IOSStatusBar isDark={isDark} /> : <AndroidStatusBar isDark={isDark} />}
              </div>

              <div className="flex-1" />

              <div style={{ pointerEvents: "none" }}>
                {isIOS ? (
                  isSE || isClassicNotch ? null : <IOSHomeIndicator isDark={isDark} />
                ) : (
                  <AndroidNavBar isDark={isDark} />
                )}
              </div>
            </div>

            <div className="absolute inset-0" style={{ zIndex: 10 }}>
              {children}
            </div>
          </div>

          {isSE && isIOS && (
            <div
              className="absolute left-0 right-0 flex items-center justify-center"
              style={{ bottom: 0, height: bottomBezel }}
            >
              <ClassicHomeButton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
