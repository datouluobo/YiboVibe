#!/bin/bash
# Post-build script: copy CanvasKit locally for proxy-bypass
# Run after: flutter build web
FLUTTER_SDK="/mnt/d/Program/Flutter"
BUILD_DIR="./build/web"

if [ ! -d "$BUILD_DIR/canvaskit" ]; then
  echo "Copying CanvasKit to $BUILD_DIR/canvaskit..."
  cp -r "$FLUTTER_SDK/bin/cache/flutter_web_sdk/canvaskit" "$BUILD_DIR/canvaskit"
  
  # Patch flutter_bootstrap.js
  sed -i 's|"mainJsPath":"main.dart.js"}|"mainJsPath":"main.dart.js","canvasKitBaseUrl":"canvaskit"}|' "$BUILD_DIR/flutter_bootstrap.js"
  sed -i 's|_flutter.loader.load({|_flutter.loader.load({\n  config: {\n    canvasKitBaseUrl: "canvaskit"\n  },|' "$BUILD_DIR/flutter_bootstrap.js"
  
  echo "Done. CanvasKit now served locally."
else
  echo "CanvasKit already present."
fi
