#!/bin/bash

# Test suite that simulates how Claude Desktop calls the MCP bridge
# This replicates the subprocess stdin/stdout JSON-RPC communication

set -e

echo "=== MCP Bridge Testing Suite (Claude Desktop Simulation) ==="
echo "This test simulates how Claude Desktop actually calls the bridge via subprocess stdin/stdout"
echo ""

test_count=0
pass_count=0
fail_count=0

run_test() {
  local test_name="$1"
  local server_url="$2"
  local bridge_name="$3"
  local expected_tool_count="$4"

  test_count=$((test_count + 1))

  echo "Test $test_count: $test_name"
  echo "  Bridge: $bridge_name"
  echo "  Server: $server_url"

  # Run bridge subprocess and capture output
  temp_output=$(mktemp)

  {
    # Initialize request
    echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"},"initializationOptions":{}}}'
    sleep 0.5

    # Tools list request
    echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
    sleep 2

    # Close stdin to signal end of input
  } | (
    export server_url="$server_url"
    export api_token="default-api-key"
    timeout 10 /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js 2>&1
  ) > "$temp_output" 2>&1

  # Check for initialize response
  if grep -q '"id":1' "$temp_output" && grep -q '"result"' "$temp_output"; then
    # Check for tools list response
    if grep -q '"id":2' "$temp_output" && grep -q '"tools"' "$temp_output"; then
      # Count tools
      tool_count=$(grep -o '"name":"[^"]*"' "$temp_output" | grep -v "version\|name\|serverInfo" | wc -l)

      if [ "$tool_count" -ge "$expected_tool_count" ]; then
        echo "  ✅ PASS"
        echo "     - Initialize response: OK"
        echo "     - Tools response: OK"
        echo "     - Tool count: $tool_count (expected: >= $expected_tool_count)"
        pass_count=$((pass_count + 1))
      else
        echo "  ❌ FAIL: Tool count mismatch"
        echo "     - Expected: >= $expected_tool_count tools"
        echo "     - Got: $tool_count tools"
        fail_count=$((fail_count + 1))
      fi
    else
      echo "  ❌ FAIL: No tools/list response"
      fail_count=$((fail_count + 1))
    fi
  else
    echo "  ❌ FAIL: No initialize response"
    fail_count=$((fail_count + 1))
  fi

  echo ""
  rm -f "$temp_output"
}

# Run tests for all 4 working servers
run_test "Math Bridge" "http://127.0.0.1:3001/sse" "math-bridge" 2
run_test "Santa Clara Bridge" "http://127.0.0.1:3002/sse" "santa-clara-bridge" 1
run_test "YouTube Transcript Bridge" "http://127.0.0.1:3003/sse" "youtube-transcript-bridge" 1
run_test "YouTube-to-MP3 Bridge" "http://127.0.0.1:3004/sse" "youtube-to-mp3-bridge" 1

echo "=== Test Results ==="
echo "Total tests: $test_count"
echo "Passed: $pass_count"
echo "Failed: $fail_count"
echo ""

if [ $fail_count -eq 0 ]; then
  echo "🎉 All tests passed!"
  exit 0
else
  echo "❌ Some tests failed"
  exit 1
fi
