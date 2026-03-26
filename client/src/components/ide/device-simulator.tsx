import { ReactNode } from "react";
import { getDeviceDimensions, type Orientation, type DeviceSpec } from "@/lib/device-specs";

interface DeviceSimulatorProps {
  deviceSpec: DeviceSpec;
  orientation: Orientation;
  frameStyle: "light" | "dark";
  children: ReactNode;
}

export function DeviceSimulator({
  deviceSpec,
  orientation,
  frameStyle,
  children,
}: DeviceSimulatorProps) {
  const { width, height } = getDeviceDimensions(deviceSpec.id, orientation);
  const isPortrait = orientation === "portrait";
  const isIOS = deviceSpec.platform === "ios";

  // Bezel sizes in pixels
  const sideBezel = 12;
  const topBezel = isPortrait ? 16 : 12;
  const bottomBezel = isPortrait ? 16 : 12;

  // Status bar height
  const statusBarHeight = 24;
  const notchHeight = isIOS && isPortrait ? 30 : 0;
  const notchWidth = isIOS && isPortrait ? 200 : 0;

  // Home indicator for iOS
  const homeIndicatorHeight = isIOS ? 20 : 0;

  // Frame colors
  const frameBg = frameStyle === "light" ? "#f5f5f5" : "#1a1a1a";
  const frameEdge = frameStyle === "light" ? "#e5e5e5" : "#333";
  const screenBg = frameStyle === "light" ? "#fff" : "#000";

  return (
    <div
      className="flex items-center justify-center h-full w-full p-4 overflow-auto"
      style={{
        backgroundColor: frameStyle === "light" ? "#fafafa" : "#0a0a0a",
      }}
    >
      {/* Device frame */}
      <div
        className="relative rounded-3xl shadow-2xl overflow-hidden flex-shrink-0"
        style={{
          width: width + sideBezel * 2,
          height: height + topBezel + bottomBezel,
          backgroundColor: frameBg,
          border: `1px solid ${frameEdge}`,
          boxShadow: frameStyle === "light"
            ? "0 20px 60px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)"
            : "0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1)",
        }}
      >
        {/* Top bezel with status bar and notch */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-4"
          style={{
            height: topBezel + statusBarHeight + notchHeight,
            backgroundColor: frameStyle === "light" ? "#f0f0f0" : "#0d0d0d",
            borderBottom: `1px solid ${frameEdge}`,
            paddingTop: topBezel / 2,
            color: frameStyle === "light" ? "#000" : "#fff",
            fontSize: "10px",
            gap: "8px",
          }}
        >
          {/* Status bar content */}
          <div className="flex items-center gap-1">
            <span>📶</span>
            <span>📡</span>
          </div>

          {/* Notch (iOS) */}
          {isIOS && isPortrait && (
            <div
              className="absolute top-2 left-1/2 transform -translate-x-1/2 rounded-b-2xl"
              style={{
                width: notchWidth,
                height: notchHeight,
                backgroundColor: frameBg,
                border: `1px solid ${frameEdge}`,
              }}
            />
          )}

          <div className="flex items-center gap-1">
            <span>🔋</span>
          </div>
        </div>

        {/* Screen content */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: topBezel + statusBarHeight + notchHeight,
            bottom: bottomBezel + homeIndicatorHeight,
            left: sideBezel,
            right: sideBezel,
            backgroundColor: screenBg,
            overflow: "hidden",
            borderRadius: "16px 16px 0 0",
          }}
        >
          {children}
        </div>

        {/* Home indicator (iOS) / Navigation bar (Android) */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
          style={{
            height: bottomBezel + homeIndicatorHeight,
            backgroundColor: frameStyle === "light" ? "#f0f0f0" : "#0d0d0d",
            borderTop: `1px solid ${frameEdge}`,
          }}
        >
          {isIOS ? (
            // iOS home indicator
            <div
              className="rounded-full"
              style={{
                width: "120px",
                height: "4px",
                backgroundColor: frameStyle === "light" ? "#999" : "#666",
              }}
            />
          ) : (
            // Android navigation buttons
            <div className="flex items-center gap-8">
              <div
                className="rounded"
                style={{
                  width: "24px",
                  height: "24px",
                  backgroundColor: frameStyle === "light" ? "#ccc" : "#555",
                }}
              />
              <div
                className="rounded-full"
                style={{
                  width: "24px",
                  height: "24px",
                  backgroundColor: frameStyle === "light" ? "#ccc" : "#555",
                }}
              />
              <div
                className="rounded"
                style={{
                  width: "24px",
                  height: "24px",
                  backgroundColor: frameStyle === "light" ? "#ccc" : "#555",
                }}
              />
            </div>
          )}
        </div>

        {/* Side bezels (rounded corners) */}
        <div
          className="absolute top-0 left-0 w-full h-full pointer-events-none rounded-3xl"
          style={{
            border: `${sideBezel}px solid ${frameBg}`,
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}
