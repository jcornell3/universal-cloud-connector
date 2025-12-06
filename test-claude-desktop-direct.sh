#!/bin/bash

# This script simulates exactly how Claude Desktop calls the bridge
# Run this to verify the bridge works before testing in Claude Desktop

echo "=== Testing Bridge with Claude Desktop Command ==="
echo ""

# Use the exact command from claude_desktop_config.json
cd /home/jcornell/universal-cloud-connector && \
export server_url='http://127.0.0.1:3001/sse' && \
export api_token='default-api-key' && \
echo "Starting bridge with environment:" && \
echo "  server_url=$server_url" && \
echo "  api_token=$api_token" && \
echo "  node=$(which node)" && \
echo "  node version=$(node --version)" && \
echo "" && \
echo "Sending initialize request in 1 second..." && \
echo "" && \
(
  sleep 1
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
  sleep 3
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  sleep 2
) | /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js 2>&1 | tee /tmp/bridge-test-output.log

echo ""
echo "=== Test Complete ==="
echo "Full output saved to: /tmp/bridge-test-output.log"
