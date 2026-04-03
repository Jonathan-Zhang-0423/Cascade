#!/bin/bash
set -e
npm install
npm run db:push

if [ -f "scripts/setup-gradle.sh" ]; then
  echo "Setting up Gradle SDK..."
  bash scripts/setup-gradle.sh || echo "WARNING: Gradle setup failed, Kotlin/Wasm preview will be unavailable"
fi

if [ -f "scripts/setup-swift-wasm.sh" ]; then
  echo "Setting up SwiftWasm toolchain..."
  bash scripts/setup-swift-wasm.sh || echo "WARNING: SwiftWasm setup failed, SwiftUI preview will be unavailable"
fi
