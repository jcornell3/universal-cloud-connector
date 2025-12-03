#!/bin/bash

# Universal Cloud Connector - Bundle Creation Script
# This script creates a .mcpb (MCP Bundle) file from the compiled project

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
OUTPUT_FILE="$PROJECT_DIR/universal-cloud-connector.mcpb"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Universal Cloud Connector Bundle Creator ===${NC}"
echo "Project Directory: $PROJECT_DIR"
echo "Distribution Directory: $DIST_DIR"
echo "Output Bundle: $OUTPUT_FILE"
echo ""

# Check if dist directory exists
if [ ! -d "$DIST_DIR" ]; then
  echo -e "${RED}ERROR: dist directory not found. Run 'npm run build' first.${NC}"
  exit 1
fi

# Check if manifest.json exists
if [ ! -f "$PROJECT_DIR/manifest.json" ]; then
  echo -e "${RED}ERROR: manifest.json not found.${NC}"
  exit 1
fi

# Create temporary directory for bundle contents
TEMP_BUNDLE_DIR=$(mktemp -d)
trap "rm -rf $TEMP_BUNDLE_DIR" EXIT

echo -e "${BLUE}Preparing bundle contents...${NC}"

# Copy manifest
cp "$PROJECT_DIR/manifest.json" "$TEMP_BUNDLE_DIR/"
echo "✓ Copied manifest.json"

# Copy compiled JavaScript and source maps
cp -r "$DIST_DIR" "$TEMP_BUNDLE_DIR/"
echo "✓ Copied compiled code (dist/)"

# Copy node_modules (required for runtime dependencies like eventsource)
if [ -d "$PROJECT_DIR/node_modules" ]; then
  cp -r "$PROJECT_DIR/node_modules" "$TEMP_BUNDLE_DIR/"
  echo "✓ Copied node_modules"
else
  echo -e "${RED}WARNING: node_modules not found. Run 'npm install' first.${NC}"
fi

# Copy package.json (required for module resolution)
cp "$PROJECT_DIR/package.json" "$TEMP_BUNDLE_DIR/"
echo "✓ Copied package.json"

# Copy README if it exists
if [ -f "$PROJECT_DIR/README.md" ]; then
  cp "$PROJECT_DIR/README.md" "$TEMP_BUNDLE_DIR/"
  echo "✓ Copied README.md"
fi

# Copy LICENSE if it exists
if [ -f "$PROJECT_DIR/LICENSE" ]; then
  cp "$PROJECT_DIR/LICENSE" "$TEMP_BUNDLE_DIR/"
  echo "✓ Copied LICENSE"
fi

# Create the bundle (zip file with .mcpb extension)
echo -e "${BLUE}Creating bundle archive...${NC}"

# Change to temp directory to avoid including full path
cd "$TEMP_BUNDLE_DIR"

# Try zip first, fall back to tar if not available
if command -v zip &> /dev/null; then
  zip -r -q "$OUTPUT_FILE" .
  LIST_CMD="unzip -l"
else
  # Use tar as fallback - .mcpb can be a tar.gz file too
  tar -czf "$OUTPUT_FILE" .
  LIST_CMD="tar -tzf"
fi

cd - > /dev/null

# Calculate file size
FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

echo -e "${GREEN}✓ Bundle created successfully!${NC}"
echo ""
echo -e "${BLUE}Bundle Details:${NC}"
echo "  Path: $OUTPUT_FILE"
echo "  Size: $FILE_SIZE"
echo "  Format: Archive (.mcpb)"
echo ""
echo -e "${BLUE}Installation:${NC}"
echo "  1. Copy the .mcpb file to your Claude Desktop extensions folder"
echo "  2. Configure it with your server_url and api_token"
echo "  3. Restart Claude Desktop"
echo ""
echo "Bundle contents:"
if [ "$LIST_CMD" = "unzip -l" ]; then
  unzip -l "$OUTPUT_FILE" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
else
  tar -tzf "$OUTPUT_FILE" | awk '{print "  " $0}'
fi
