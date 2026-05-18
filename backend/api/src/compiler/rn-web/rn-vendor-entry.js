/**
 * Vendor entry point for esbuild.
 * Exports React, ReactDOM, react-native-web, and the navigation ecosystem
 * as a single IIFE bundle accessible via window.__RNW__ in the preview iframe.
 *
 * NOTE: react-native-gesture-handler and react-native-reanimated are NOT bundled
 * here because they call TurboModuleRegistry.getEnforcing() at module init time,
 * which throws in a web context. They are stubbed at runtime in the HTML shell.
 *
 * Must use ES module exports (not module.exports) so esbuild's globalName
 * option correctly assigns the exports object to window.__RNW__.
 */
export { default as React } from "react";
export * as ReactDOM from "react-dom/client";
export * as ReactNativeWeb from "react-native-web";
export * as ReactNavigation from "@react-navigation/native";
export * as ReactNavigationStack from "@react-navigation/stack";
export * as ReactNavigationBottomTabs from "@react-navigation/bottom-tabs";
export * as SafeAreaContext from "react-native-safe-area-context";
export * as ExpoStatusBar from "expo-status-bar";
