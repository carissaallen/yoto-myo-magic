#!/bin/bash

# Build script for Chrome Web Store submission
# Creates a clean ZIP file excluding test and development files

echo "Building Yoto MYO Magic extension for Chrome Web Store..."

# Extension name and version
EXTENSION_NAME="yoto-myo-magic"
VERSION=$(grep '"version"' manifest.json | cut -d '"' -f 4)
OUTPUT_FILE="${EXTENSION_NAME}-v${VERSION}.zip"

# Remove old build if exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "Removing old build: $OUTPUT_FILE"
    rm "$OUTPUT_FILE"
fi

# Create the ZIP file, excluding files listed in .chromeignore
echo "Creating ZIP file: $OUTPUT_FILE"

# Files and directories to include
zip -r "$OUTPUT_FILE" \
    manifest.json \
    jszip.min.js \
    callback.html \
    callback.js \
    config.js \
    _locales/ \
    assets/ \
    background/ \
    content/ \
    images/ \
    lib/ \
    offscreen/ \
    options/ \
    popup/ \
    utils/ \
    -x "*.DS_Store" \
    -x "*/.DS_Store" \
    -x "*.swp" \
    -x "*.swo" \
    -x "*~" \
    -x "test-files/*" \
    -x "docs/*" \
    -x "*.md" \
    -x ".git/*" \
    -x ".gitignore" \
    -x ".chromeignore" \
    -x ".idea/*" \
    -x "node_modules/*" \
    -x "package*.json" \
    -x "config.template.js" \
    -x "build.sh" \
    -x "LICENSE"

echo "✅ Build complete: $OUTPUT_FILE"
echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo "This file is ready for upload to the Chrome Web Store."
echo "Visit: https://chrome.google.com/webstore/developer/dashboard"