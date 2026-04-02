#!/bin/bash
set -e

SWIFT_VERSION="${SWIFT_VERSION:-6.1}"
SWIFT_RELEASE="swift-${SWIFT_VERSION}-RELEASE"
SWIFT_PLATFORM="${SWIFT_PLATFORM:-ubuntu24.04}"
SWIFT_INSTALL_DIR="$HOME/.swift-wasm-sdk"
SWIFT_TOOLCHAIN_DIR="$SWIFT_INSTALL_DIR/${SWIFT_RELEASE}-${SWIFT_PLATFORM}"
SWIFT_BIN="$SWIFT_TOOLCHAIN_DIR/usr/bin/swift"

SWIFTWASM_SDK_TAG="swift-wasm-${SWIFT_VERSION}-RELEASE"
SWIFTWASM_SDK_TARGET="${SWIFT_WASM_SDK_ID:-wasm32-unknown-wasi}"
SWIFTWASM_SDK_URL="https://github.com/swiftwasm/swift/releases/download/${SWIFTWASM_SDK_TAG}/${SWIFTWASM_SDK_TAG}-${SWIFTWASM_SDK_TARGET}.artifactbundle.zip"

SWIFT_DOWNLOAD_URL="https://download.swift.org/${SWIFT_RELEASE,,}/${SWIFT_PLATFORM//./}/${SWIFT_RELEASE}/${SWIFT_RELEASE}-${SWIFT_PLATFORM}.tar.gz"

SWIFT_TOOLCHAIN_SHA256="${SWIFT_TOOLCHAIN_SHA256:-}"
SWIFTWASM_SDK_SHA256="${SWIFTWASM_SDK_SHA256:-}"

verify_checksum() {
  local file="$1"
  local expected="$2"
  local label="$3"

  if [ -z "$expected" ]; then
    echo "WARNING: No checksum provided for $label — skipping integrity verification"
    return 0
  fi

  local actual
  actual=$(sha256sum "$file" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: Checksum mismatch for $label" >&2
    echo "  Expected: $expected" >&2
    echo "  Actual:   $actual" >&2
    rm -f "$file"
    exit 1
  fi
  echo "Checksum verified for $label"
}

install_swift_toolchain() {
  if [ -x "$SWIFT_BIN" ]; then
    echo "Swift ${SWIFT_VERSION} already installed at $SWIFT_BIN"
    return 0
  fi

  echo "Installing Swift ${SWIFT_VERSION} for ${SWIFT_PLATFORM}..."
  mkdir -p "$SWIFT_INSTALL_DIR"

  local TEMP_TAR="/tmp/${SWIFT_RELEASE}-${SWIFT_PLATFORM}.tar.gz"

  echo "Downloading Swift toolchain from ${SWIFT_DOWNLOAD_URL}..."
  if ! curl -fsSL "$SWIFT_DOWNLOAD_URL" -o "$TEMP_TAR"; then
    echo "ERROR: Failed to download Swift toolchain" >&2
    rm -f "$TEMP_TAR"
    exit 1
  fi

  verify_checksum "$TEMP_TAR" "$SWIFT_TOOLCHAIN_SHA256" "Swift toolchain"

  echo "Extracting Swift toolchain..."
  tar -xzf "$TEMP_TAR" -C "$SWIFT_INSTALL_DIR"
  rm -f "$TEMP_TAR"

  if [ ! -x "$SWIFT_BIN" ]; then
    echo "ERROR: Swift binary not found at $SWIFT_BIN after extraction" >&2
    echo "Contents of $SWIFT_INSTALL_DIR:" >&2
    ls -la "$SWIFT_INSTALL_DIR" >&2
    exit 1
  fi

  echo "Swift ${SWIFT_VERSION} installed successfully"
  "$SWIFT_BIN" --version
}

install_swiftwasm_sdk() {
  local SDK_LIST
  SDK_LIST=$("$SWIFT_BIN" sdk list 2>/dev/null || true)

  if echo "$SDK_LIST" | grep -q "$SWIFTWASM_SDK_TARGET"; then
    echo "SwiftWasm SDK for ${SWIFTWASM_SDK_TARGET} already installed"
    return 0
  fi

  echo "Installing SwiftWasm SDK from ${SWIFTWASM_SDK_URL}..."

  local TEMP_ZIP="/tmp/${SWIFTWASM_SDK_TAG}-${SWIFTWASM_SDK_TARGET}.artifactbundle.zip"

  if ! curl -fsSL "$SWIFTWASM_SDK_URL" -o "$TEMP_ZIP"; then
    echo "ERROR: Failed to download SwiftWasm SDK" >&2
    rm -f "$TEMP_ZIP"
    exit 1
  fi

  verify_checksum "$TEMP_ZIP" "$SWIFTWASM_SDK_SHA256" "SwiftWasm SDK"

  echo "Installing SwiftWasm SDK artifact bundle..."
  if ! "$SWIFT_BIN" sdk install "$TEMP_ZIP"; then
    echo "ERROR: Failed to install SwiftWasm SDK" >&2
    rm -f "$TEMP_ZIP"
    exit 1
  fi

  rm -f "$TEMP_ZIP"

  echo "SwiftWasm SDK installed successfully"
  "$SWIFT_BIN" sdk list
}

verify_installation() {
  echo ""
  echo "=== Verification ==="
  echo "Swift binary: $SWIFT_BIN"
  "$SWIFT_BIN" --version
  echo ""
  echo "Installed SDKs:"
  local SDK_LIST
  SDK_LIST=$("$SWIFT_BIN" sdk list 2>/dev/null || true)
  echo "$SDK_LIST"

  if ! echo "$SDK_LIST" | grep -q "$SWIFTWASM_SDK_TARGET"; then
    echo "ERROR: SwiftWasm SDK for ${SWIFTWASM_SDK_TARGET} not found in installed SDKs" >&2
    exit 1
  fi

  echo ""
  echo "SwiftWasm toolchain setup complete."
  echo "Set SWIFT_WASM_PATH=$SWIFT_BIN to use in the application."
}

echo "=== SwiftWasm Toolchain Setup ==="
echo "Swift version: ${SWIFT_VERSION}"
echo "Platform: ${SWIFT_PLATFORM}"
echo "SDK target: ${SWIFTWASM_SDK_TARGET}"
echo ""

install_swift_toolchain
install_swiftwasm_sdk
verify_installation
