#!/bin/bash
set -e
npm install
npm run db:push

if [ -f "scripts/setup-swift-wasm.sh" ]; then
  echo "Setting up SwiftWasm toolchain..."
  bash scripts/setup-swift-wasm.sh || echo "WARNING: SwiftWasm setup failed, SwiftUI preview will be unavailable"
fi
