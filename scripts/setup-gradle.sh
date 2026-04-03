#!/bin/bash
set -e

GRADLE_VERSION="8.10"
GRADLE_DIR="$HOME/.gradle-sdk/gradle-$GRADLE_VERSION"
GRADLE_BIN="$GRADLE_DIR/bin/gradle"

if [ -x "$GRADLE_BIN" ]; then
  echo "Gradle $GRADLE_VERSION already installed at $GRADLE_BIN"
  exit 0
fi

echo "Installing Gradle $GRADLE_VERSION..."
DOWNLOAD_URL="https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
TEMP_ZIP="/tmp/gradle-$GRADLE_VERSION-bin.zip"

mkdir -p "$HOME/.gradle-sdk"
curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_ZIP"
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TEMP_ZIP" "$HOME/.gradle-sdk"
rm -f "$TEMP_ZIP"
chmod +x "$GRADLE_BIN" 2>/dev/null || true

if [ -x "$GRADLE_BIN" ]; then
  echo "Gradle $GRADLE_VERSION installed successfully at $GRADLE_BIN"
else
  echo "ERROR: Gradle installation failed" >&2
  exit 1
fi
