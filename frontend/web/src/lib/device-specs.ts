export interface DeviceSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  platform: "ios" | "android";
  hasDynamicIsland?: boolean;
  screenRadius?: number;
  safeAreaInsets?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export const DEVICE_SPECS: Record<string, DeviceSpec> = {
  "iphone-se": {
    id: "iphone-se",
    name: "iPhone SE",
    width: 375,
    height: 667,
    platform: "ios",
    hasDynamicIsland: false,
    screenRadius: 0,
    safeAreaInsets: { top: 20, bottom: 0, left: 0, right: 0 },
  },
  "iphone-15": {
    id: "iphone-15",
    name: "iPhone 15",
    width: 393,
    height: 852,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-15-pro-max": {
    id: "iphone-15-pro-max",
    name: "iPhone 15 Pro Max",
    width: 430,
    height: 932,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-16": {
    id: "iphone-16",
    name: "iPhone 16",
    width: 393,
    height: 852,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-16-plus": {
    id: "iphone-16-plus",
    name: "iPhone 16 Plus",
    width: 430,
    height: 932,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-16-pro": {
    id: "iphone-16-pro",
    name: "iPhone 16 Pro",
    width: 402,
    height: 874,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-16-pro-max": {
    id: "iphone-16-pro-max",
    name: "iPhone 16 Pro Max",
    width: 440,
    height: 956,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-17": {
    id: "iphone-17",
    name: "iPhone 17",
    width: 393,
    height: 852,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-17-plus": {
    id: "iphone-17-plus",
    name: "iPhone 17 Plus",
    width: 430,
    height: 932,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-17-pro": {
    id: "iphone-17-pro",
    name: "iPhone 17 Pro",
    width: 402,
    height: 874,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  "iphone-17-pro-max": {
    id: "iphone-17-pro-max",
    name: "iPhone 17 Pro Max",
    width: 440,
    height: 956,
    platform: "ios",
    hasDynamicIsland: true,
    screenRadius: 55,
    safeAreaInsets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  ipad: {
    id: "ipad",
    name: "iPad",
    width: 810,
    height: 1080,
    platform: "ios",
    hasDynamicIsland: false,
    screenRadius: 18,
    safeAreaInsets: { top: 24, bottom: 24, left: 24, right: 24 },
  },
  "pixel-7": {
    id: "pixel-7",
    name: "Pixel 7",
    width: 412,
    height: 915,
    platform: "android",
    screenRadius: 40,
    safeAreaInsets: { top: 24, bottom: 0, left: 0, right: 0 },
  },
  "pixel-fold": {
    id: "pixel-fold",
    name: "Pixel Fold",
    width: 884,
    height: 1104,
    platform: "android",
    screenRadius: 24,
    safeAreaInsets: { top: 24, bottom: 0, left: 0, right: 0 },
  },
  "galaxy-s24": {
    id: "galaxy-s24",
    name: "Samsung Galaxy S24",
    width: 360,
    height: 780,
    platform: "android",
    screenRadius: 40,
    safeAreaInsets: { top: 24, bottom: 0, left: 0, right: 0 },
  },
};

export const DEVICE_LIST = Object.values(DEVICE_SPECS);

export function getDeviceSpec(deviceId: string): DeviceSpec {
  return DEVICE_SPECS[deviceId] || DEVICE_SPECS["iphone-16-pro"];
}

export function getDeviceName(deviceId: string): string {
  return DEVICE_SPECS[deviceId]?.name || "iPhone 16 Pro";
}

export function getFirstDeviceForPlatform(platform: "ios" | "android"): string {
  const device = DEVICE_LIST.find((d) => d.platform === platform);
  return device?.id || "iphone-16-pro";
}

export const ORIENTATION_PRESETS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATION_PRESETS)[number];

export function getDeviceDimensions(
  deviceId: string,
  orientation: Orientation
): { width: number; height: number } {
  const spec = getDeviceSpec(deviceId);

  if (orientation === "landscape") {
    return { width: spec.height, height: spec.width };
  }

  return { width: spec.width, height: spec.height };
}

export function makeCustomSpec(width: number, height: number, platform: "ios" | "android"): DeviceSpec {
  return {
    id: "custom",
    name: "Custom",
    width,
    height,
    platform,
    hasDynamicIsland: false,
  };
}
