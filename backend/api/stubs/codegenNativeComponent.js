/**
 * Stub for react-native/Libraries/Utilities/codegenNativeComponent
 * Used by react-native-safe-area-context (RNCSafeAreaProvider, RNCSafeAreaView).
 * Must NOT import react-native-web here — this runs inside the vendor bundle
 * before RNW is initialised. Instead return a forwardRef wrapper that renders
 * a plain <div> so SafeAreaProvider/SafeAreaView pass children through.
 */
import React from 'react';

export default function codegenNativeComponent(name, _options) {
  const NativeStub = React.forwardRef(function({ children, style, onLayout }, ref) {
    return React.createElement('div', { ref, style, 'data-native-stub': name }, children);
  });
  NativeStub.displayName = name || 'NativeStub';
  return NativeStub;
}
