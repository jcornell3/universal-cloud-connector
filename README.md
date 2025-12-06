# Universal Cloud Connector

**Status**: Production Ready ✅
**Last Updated**: December 6, 2025

A universal bridge that connects Claude Desktop to remote SSE-based MCP servers via HTTP/SSE transport.

---

## Overview

The Universal Cloud Connector enables Claude Desktop to communicate with MCP servers that use HTTP/SSE instead of stdio. It acts as a protocol adapter, translating between:

- **Claude Desktop** ← stdio → **Bridge** ← HTTP/SSE → **Remote MCP Server**

### Supported Deployment Targets

- Docker containers (current production use)
- Virtual Private Servers (VPS)
- Any server with HTTP/SSE support
- Local development servers

**Note**: Cloudflare Workers are NOT supported due to CPU time limits (see [docs/LESSONS_LEARNED_CONSOLIDATED.md](../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md#lesson-8-cloudflare-workers-cannot-handle-sse-properly)).

---

## Quick Start

### Current Production Deployment

The bridge is currently deployed and working with these MCP servers:

| Server | Port | Tools |
|--------|------|-------|
| math-bridge | 3001 | calculate, factorial |
| santa-clara-bridge | 3002 | get_property_info |
| youtube-transcript-bridge | 3003 | get_transcript, list_available_languages |
| youtube-to-mp3-bridge | 3004 | youtube_to_mp3 |
| github-remote-bridge | 3005 | Repository operations, issues, PRs, code search |

### Prerequisites

- Node.js 24+ (tested with v24.11.1)
- npm or yarn
- Claude Desktop
- Docker (for running MCP server containers)

### Installation

```bash
# 1. Clone the repository
cd /home/jcornell/universal-cloud-connector

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# Output: dist/index.js (ready to use)
```

### Configuration

Add to Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "math-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3001/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    }
  }
}
```

**Environment Variables**:
- `server_url`: Full URL to SSE endpoint (must end with `/sse`)
- `api_token`: Bearer token for authentication

---

## Architecture

### Communication Flow

```
1. Bridge connects to /sse endpoint
2. Server sends: event: endpoint
               data: /messages?session_id=abc123
3. Bridge extracts session_id
4. Claude Desktop sends request via stdin
5. Bridge POSTs to /messages?session_id=abc123
6. Server responds via SSE stream
7. Bridge forwards response to stdout
```

### Key Features

✅ **SSE Endpoint Event Pattern**: Waits for session_id before processing requests
✅ **Request ID Correlation**: Tracks pending requests to match responses
✅ **Message Deduplication**: Prevents duplicate messages during reconnects
✅ **Automatic Retry**: Handles connection failures gracefully
✅ **Comprehensive Logging**: Detailed diagnostics for troubleshooting

### Recent Fixes (December 6, 2025)

1. **SSE Endpoint Race Condition** ✅ FIXED
   - Extended `waitForSessionId()` timeout from 1s to 10s
   - Added progress logging
   - Eliminated HTTP 400 errors and infinite reconnects
   - **Impact**: All bridge servers now working reliably

2. **GitHub Wrapper Architecture** ✅ FIXED
   - Changed from shared-process to per-session-process model
   - Each SSE connection gets dedicated GitHub server process
   - Proper stdio stream isolation
   - **Impact**: GitHub tools now functional

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for complete technical details.

---

## Project Structure

```
universal-cloud-connector/
├── src/
│   └── index.ts              # Main bridge implementation
├── dist/
│   └── index.js              # Compiled output (used by Claude Desktop)
├── docs/
│   ├── ARCHITECTURE.md       # Complete architecture documentation
│   ├── BUILD.md              # Build instructions
│   ├── DEPLOYMENT.md         # Deployment guide
│   ├── QUICK_START.md        # Getting started guide
│   └── LESSONS_LEARNED.md    # Development insights
├── tests/
│   ├── test-eventsource.mjs         # EventSource library test
│   ├── test-claude-desktop-simulation.js  # Protocol flow test
│   └── run-all-tests.sh             # Automated test suite
├── package.json
├── tsconfig.json
└── README.md
```

---

## Testing

### Automated Tests

Run the complete test suite:

```bash
cd /home/jcornell/universal-cloud-connector
./run-all-tests.sh
```

**Tests Include**:
1. EventSource library verification
2. Claude Desktop protocol flow simulation (race condition testing)

**Expected Output**:
```
✅ Test 1 PASSED: EventSource library works correctly
✅ Test 2 PASSED: Bridge handles Claude Desktop protocol flow correctly

ALL TESTS PASSED ✅
```

### Manual Testing

```bash
# Test direct connection
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  server_url="http://127.0.0.1:3001/sse" \
  api_token="default-api-key" \
  node dist/index.js
```

### Health Checks

```bash
# Check all servers
for port in 3001 3002 3003 3004 3005; do
  echo "Port $port:"
  curl -s http://127.0.0.1:$port/health
done
```

---

## Usage

### In Claude Desktop

After configuration and restart:

1. **Math Tools**:
   ```
   Ask Claude: "What is 15 + 27?"
   Claude uses: math-bridge → calculate tool
   ```

2. **YouTube Tools**:
   ```
   Ask Claude: "Get the transcript of https://youtube.com/watch?v=..."
   Claude uses: youtube-transcript-bridge → get_transcript
   ```

3. **GitHub Tools**:
   ```
   Ask Claude: "Search for Python repos with 50k+ stars"
   Claude uses: github-remote-bridge → search_repositories
   ```

### Logs and Debugging

**Claude Desktop Logs**:
- Help → Export Logs → Extract .zip
- Check `mcp-server-[name]-bridge.log`

**Look for**:
- ✅ `[ENDPOINT-EVENT] Received`
- ✅ `Session ID extracted`
- ✅ `Session ID ready after Xms`
- ❌ `POST request failed with status 400` (bad - indicates issue)

---

## Troubleshooting

### Common Issues

**1. Tools Not Available in Claude Desktop**
- **Cause**: Chat session isolation (Claude Desktop binds tools to specific chats)
- **Fix**: Restart Claude Desktop, create new chat session

**2. HTTP 400 "session_id is required"**
- **Cause**: Bridge not waiting for endpoint event
- **Fix**: Ensure using latest build with 10-second timeout
- **Verify**: Check logs for `[ENDPOINT-EVENT] Received`

**3. Server Not Responding**
- **Check**: Docker containers running (`docker-compose ps`)
- **Check**: Server health endpoints (`curl http://localhost:3001/health`)
- **Fix**: Restart containers (`docker-compose restart`)

See [../mcp-dev-environment/docs/TROUBLESHOOTING.md](../mcp-dev-environment/docs/TROUBLESHOOTING.md) for comprehensive troubleshooting guide.

---

## Development

### Building from Source

```bash
npm install
npm run build
```

### Running Tests

```bash
./run-all-tests.sh
```

### Making Changes

1. Edit `src/index.ts`
2. Run `npm run build`
3. Test with `./run-all-tests.sh`
4. Test in Claude Desktop
5. Commit changes

### Development Workflow

For detailed development practices, see:
- [docs/BUILD.md](docs/BUILD.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md](../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md)

---

## Documentation

### Core Documentation
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Complete technical architecture
- [QUICK_START.md](docs/QUICK_START.md) - Getting started guide
- [BUILD.md](docs/BUILD.md) - Build and development instructions
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide

### Related Documentation (mcp-dev-environment)
- [TROUBLESHOOTING.md](../mcp-dev-environment/docs/TROUBLESHOOTING.md) - Troubleshooting guide
- [ISSUES_AND_FIXES_CONSOLIDATED.md](../mcp-dev-environment/docs/ISSUES_AND_FIXES_CONSOLIDATED.md) - All known issues and fixes
- [LESSONS_LEARNED_CONSOLIDATED.md](../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md) - Development lessons
- [SETUP_GUIDE.md](../mcp-dev-environment/docs/SETUP_GUIDE.md) - Complete setup guide

---

## Known Limitations

1. **Chat Session Isolation**: Tools bind to specific Claude Desktop chat sessions (restart Claude Desktop to use in new chats)
2. **WSL Requirement**: Current setup requires WSL on Windows (could be adapted for native Windows)
3. **No Dynamic Routing**: Each server requires separate bridge instance (could be enhanced)

---

## Performance

- **SSE Connection**: ~10-60ms to establish
- **Request Processing**: <10ms bridge overhead
- **Total Latency**: ~100-600ms end-to-end (varies by server operation)

---

## License

See [LICENSE](LICENSE) file for details.

---

## Support

**For Issues**:
1. Check [TROUBLESHOOTING.md](../mcp-dev-environment/docs/TROUBLESHOOTING.md)
2. Review [ISSUES_AND_FIXES_CONSOLIDATED.md](../mcp-dev-environment/docs/ISSUES_AND_FIXES_CONSOLIDATED.md)
3. Run test suite: `./run-all-tests.sh`
4. Export Claude Desktop logs (Help → Export Logs)

**For Development Questions**:
- See [LESSONS_LEARNED_CONSOLIDATED.md](../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md)
- See [ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Change Log

### December 6, 2025
- ✅ Fixed SSE endpoint race condition (extended timeout 1s → 10s)
- ✅ Fixed GitHub wrapper architecture (per-session processes)
- ✅ All 5 bridge servers production ready and tested
- ✅ Comprehensive documentation consolidation
- ✅ Updated README with current state

### Previous Versions
See git history for detailed change log.

---

## Status

**Production Ready** ✅

All bridge servers tested and working:
- ✅ math-bridge
- ✅ santa-clara-bridge
- ✅ youtube-transcript-bridge
- ✅ youtube-to-mp3-bridge
- ✅ github-remote-bridge

Test suite passing, documentation complete, ready for production use.
