# Universal Cloud Connector Architecture

**Last Updated**: December 6, 2025
**Status**: Production Ready ✅

## Overview

The Universal Cloud Connector is a bidirectional bridge between Claude Desktop's MCP (Model Context Protocol) stdio interface and HTTP/SSE-based remote MCP servers. It enables Claude Desktop to communicate with MCP servers running in Docker containers or remote locations via HTTP/SSE transport.

---

## Current Architecture (December 2025)

```
Claude Desktop (Windows)
    ↓ stdio via WSL
┌──────────────────────────────────────────────────────┐
│ Universal Cloud Connector Bridge                     │
│ (TypeScript/Node.js)                                 │
│ /home/jcornell/universal-cloud-connector/dist/index.js│
│                                                       │
│ • Reads JSON-RPC from stdin (Claude Desktop)         │
│ • Establishes SSE connection to server               │
│ • Waits for endpoint event with session_id          │
│ • Tracks pending requests by ID                      │
│ • Sends POST with session_id to /messages            │
│ • Receives responses via SSE stream                  │
│ • Filters & forwards matching responses to stdout    │
│ • Deduplicates messages                              │
└──────────────────────────────────────────────────────┘
    ↓ HTTP POST (/messages?session_id=xxx)
    ↑ SSE Stream (/sse) + endpoint event
┌──────────────────────────────────────────────────────┐
│ MCP Server HTTP/SSE Wrappers (Docker containers)     │
│                                                       │
│ • Python Wrapper (math, santa-clara, youtube, etc.)  │
│   - Spawns one Python MCP server per HTTP session   │
│   - /sse endpoint: Sends 'endpoint' event with ID   │
│   - /messages endpoint: Accepts session_id param    │
│   - Forwards to Python MCP server via HTTP          │
│                                                       │
│ • GitHub Wrapper (Node.js)                           │
│   - Spawns one github-mcp-server per SSE session    │
│   - Per-session stdio-based server process          │
│   - Dedicated stdin/stdout per client               │
└──────────────────────────────────────────────────────┘
    ↓ HTTP or stdio
┌──────────────────────────────────────────────────────┐
│ Backend MCP Servers                                   │
│                                                       │
│ • math: Calculate & factorial (Python)               │
│ • santa-clara: Real estate data (Python)            │
│ • youtube-transcript: Video data (Python)           │
│ • youtube-to-mp3: Audio conversion (Python)         │
│ • github: Repository operations (Go binary)         │
└──────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Universal Cloud Connector Bridge

**Location**: `/home/jcornell/universal-cloud-connector/`
**Main File**: `src/index.ts` (compiled to `dist/index.js`)

**Responsibilities**:
1. Establish SSE connection to server's `/sse` endpoint
2. Wait for `endpoint` event containing session_id
3. Read JSON-RPC requests from stdin (Claude Desktop)
4. Track pending requests in `Map<id, request>`
5. Send HTTP POST to `/messages?session_id=xxx`
6. Receive responses via SSE stream
7. Match responses to pending requests by ID
8. Deduplicate messages
9. Forward matched responses to stdout

**Critical Code Sections**:

#### Session Establishment (Fixed December 6, 2025)
```typescript
private async waitForSessionId(): Promise<void> {
  let attempts = 0;
  const maxAttempts = 1000; // 10 seconds (was 100 = 1s)

  while (!this.sessionIdReceived && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 10));
    attempts++;

    if (attempts % 100 === 0) {
      this.logInfo(`Still waiting for endpoint event... (${attempts / 100}s)`);
    }
  }

  if (!this.sessionIdReceived) {
    throw new Error("Failed to receive endpoint event with session_id");
  }

  this.logInfo(`Session ID ready after ${attempts * 10}ms`);
}
```

**Fix**: Extended timeout from 1s to 10s to handle endpoint event race condition.

#### Request Tracking
```typescript
private pendingRequests: Map<string | number, JSONRPCRequest> = new Map();

async sendRequest(request: JSONRPCRequest) {
  if (request.id !== undefined) {
    this.pendingRequests.set(request.id, request);
  }

  await this.post('/messages?session_id=' + this.sessionId, request);
}
```

#### Response Matching
```typescript
onSSEMessage(data: any) {
  // Only forward responses with matching request IDs
  if ((data.result || data.error) && data.id !== undefined) {
    if (this.pendingRequests.has(data.id)) {
      stdout.write(JSON.stringify(data) + "\n");
      this.pendingRequests.delete(data.id);
    }
  }
}
```

#### Message Deduplication
```typescript
private processedMessageIds = new Set<string>();

onMessage(message: any) {
  const messageKey = `${message.id}-${JSON.stringify(message.result || message.error)}`;

  if (this.processedMessageIds.has(messageKey)) {
    return; // Skip duplicate
  }

  this.processedMessageIds.add(messageKey);
  this.handleMessage(message);
}
```

---

### 2. Python MCP Server Wrappers

**Architecture**: One Python MCP server process per HTTP session (not per SSE connection)

**How It Works**:
1. Client connects to `/sse` endpoint
2. Wrapper sends `event: endpoint` with session_id
3. Client sends POST to `/messages?session_id=xxx`
4. Wrapper finds or creates Python MCP server for that session
5. Wrapper forwards request to Python server via HTTP
6. Python server responds
7. Wrapper broadcasts response via SSE

**Key Files**:
- `servers/math-mcp/server.js` - Wrapper for math server
- `servers/santa-clara-mcp/server.js` - Wrapper for property data
- `servers/youtube-transcript-mcp/server.js` - Wrapper for transcripts
- `servers/youtube-to-mp3-mcp/server.js` - Wrapper for audio conversion

---

### 3. GitHub MCP Server Wrapper (Fixed December 6, 2025)

**Architecture**: One GitHub MCP server process per SSE session

**Why Different**: GitHub MCP server is a Go binary that uses stdio, not HTTP. Each SSE connection must have its own dedicated server process.

**How It Works**:
1. Client connects to `/sse` endpoint
2. Wrapper spawns `github-mcp-server` with dedicated stdio
3. Wrapper sends `event: endpoint` with session_id
4. Client sends POST to `/messages?session_id=xxx`
5. Wrapper writes request to server's stdin
6. Wrapper reads response from server's stdout
7. Wrapper sends response via SSE to this session only
8. When client disconnects, wrapper kills server process

**Key File**: `servers/shared/github-mcp-http-wrapper/server.js`

**Critical Fix (December 6, 2025)**:
```javascript
// OLD (Broken): One shared server for all clients
let sharedServer = spawn('github-mcp-server', ['stdio']);

// NEW (Fixed): One server per SSE session
const session = {
  id: sessionId,
  serverProcess: spawn('github-mcp-server', ['stdio']),
  response: res
};

// Kill on disconnect
req.on('close', () => {
  session.serverProcess.kill();
});
```

---

## Critical Design Patterns

### 1. SSE Endpoint Event Pattern

**The Problem**: Bridge needs session_id before sending requests, but initialize request arrives before SSE connection completes.

**The Solution**: Two-phase initialization:

```
Phase 1: SSE Connection
t=0ms   : Bridge connects to /sse
t=58ms  : SSE connection established
t=59ms  : Server sends: event: endpoint
          data: /messages?session_id=abc123
t=60ms  : Bridge extracts session_id=abc123

Phase 2: Request Processing
t=100ms : Bridge receives initialize from Claude
t=101ms : Bridge has session_id, sends POST
t=150ms : Response received via SSE
```

**Key Code**:
```typescript
// Listen for endpoint event
this.eventSource.addEventListener('endpoint', (event) => {
  const sessionId = event.data.split('session_id=')[1];
  this.sessionId = sessionId;
  this.sessionIdReceived = true;
});

// Wait for it before processing requests
await this.waitForSessionId(); // Up to 10 seconds
```

---

### 2. Request ID Correlation

Both bridge and server must preserve request IDs to match responses with requests.

**Flow**:
```
Claude Desktop → Bridge (id: 1, method: 'tools/list')
                 ↓
         pendingRequests.set(1, request)
                 ↓
Bridge → Server (id: 1, method: 'tools/list')
         ↓
Server → SSE (id: 1, result: {...})
         ↓
Bridge checks: pendingRequests.has(1)? → YES
         ↓
Bridge → Claude Desktop (id: 1, result: {...})
         ↓
         pendingRequests.delete(1)
```

---

### 3. Message Filtering

The bridge must distinguish:
- **JSON-RPC Responses**: Has `result` or `error` + matching request ID → Forward
- **Status Messages**: Just `{status: 'connected'}` → Ignore
- **Notifications**: Has `method` but no matching request → Ignore

**Implementation**:
```typescript
if ((data.result !== undefined || data.error !== undefined) &&
    data.id !== undefined &&
    this.pendingRequests.has(data.id)) {
  // This is a response to our request - forward it
  stdout.write(JSON.stringify(data) + "\n");
}
```

---

### 4. Per-Session Process Architecture (stdio servers)

For stdio-based MCP servers (like GitHub), each SSE session MUST have its own dedicated server process.

**Why**:
- stdio is one-to-one communication
- Cannot share stdin/stdout between multiple clients
- Each session maintains its own conversation state

**Implementation**:
```javascript
// Map of sessions to their server processes
const sessions = new Map();

// On SSE connection
app.get('/sse', (req, res) => {
  const sessionId = uuid();
  const serverProcess = spawn('mcp-server', ['stdio']);

  const session = {
    id: sessionId,
    serverProcess: serverProcess,
    response: res
  };

  sessions.set(sessionId, session);

  // Cleanup on disconnect
  req.on('close', () => {
    serverProcess.kill();
    sessions.delete(sessionId);
  });
});
```

---

## Configuration

### Claude Desktop Config

**File**: `/mnt/c/Users/jcorn/AppData/Roaming/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "math-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3001/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    },
    "santa-clara-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3002/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    },
    "youtube-transcript-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3003/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    },
    "youtube-to-mp3-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3004/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    },
    "github-remote-bridge": {
      "command": "wsl",
      "args": [
        "bash", "-c",
        "cd /home/jcornell/universal-cloud-connector && export server_url='http://127.0.0.1:3005/sse' && export api_token='default-api-key' && /home/jcornell/.nvm/versions/node/v24.11.1/bin/node dist/index.js"
      ]
    }
  }
}
```

### Environment Variables

**Bridge**:
- `server_url`: SSE endpoint URL (e.g., `http://127.0.0.1:3001/sse`)
- `api_token`: Authentication token (default: `default-api-key`)

**Server Wrappers**:
- `PORT`: HTTP server port (3001-3005)
- `API_TOKEN`: Expected authentication token

---

## Data Flow Example

### Complete Initialize Flow

```
1. Claude Desktop spawns bridge via WSL
   Command: wsl bash -c "... node dist/index.js"

2. Bridge starts, connects to SSE
   GET http://127.0.0.1:3001/sse

3. Server sends endpoint event
   event: endpoint
   data: /messages?session_id=abc123

4. Bridge extracts session_id
   this.sessionId = "abc123"
   this.sessionIdReceived = true

5. Claude Desktop sends initialize
   stdin: {"jsonrpc":"2.0","id":0,"method":"initialize",...}

6. Bridge has session_id, sends POST
   POST /messages?session_id=abc123
   Body: {"jsonrpc":"2.0","id":0,"method":"initialize",...}

7. Server processes, responds via SSE
   data: {"jsonrpc":"2.0","id":0,"result":{...}}

8. Bridge receives via SSE
   Checks: pendingRequests.has(0)? → YES

9. Bridge forwards to stdout
   stdout: {"jsonrpc":"2.0","id":0,"result":{...}}

10. Claude Desktop receives response
    Tools registered, ready to use
```

---

## Known Issues & Fixes

### Issue 1: SSE Endpoint Event Race Condition ✅ FIXED
**Date**: December 6, 2025
**Symptom**: HTTP 400 "session_id is required", infinite reconnects
**Root Cause**: Bridge waited only 1 second for endpoint event
**Fix**: Extended `waitForSessionId()` timeout from 1s to 10s
**Files**: `src/index.ts` lines 52-75
**Status**: All bridges working

### Issue 2: GitHub Wrapper Shared Process ✅ FIXED
**Date**: December 6, 2025
**Symptom**: GitHub bridge timeout (60s), no responses
**Root Cause**: One shared GitHub server for all clients (stdio can't be shared)
**Fix**: One GitHub server process per SSE session
**Files**: `servers/shared/github-mcp-http-wrapper/server.js`
**Status**: GitHub bridge working

### Historical Issues (All Resolved)
- Session ID correlation → Fixed with `pendingRequests` Map
- Duplicate messages → Fixed with `processedMessageIds` Set
- Response filtering → Fixed with proper JSON-RPC validation

---

## Testing

### Automated Test Suite

**Location**: `/home/jcornell/universal-cloud-connector/run-all-tests.sh`

```bash
cd /home/jcornell/universal-cloud-connector
./run-all-tests.sh
```

**Tests**:
1. EventSource library test (verifies library works)
2. Claude Desktop protocol flow simulation (replicates real timing)

**Expected Output**:
```
✅ Test 1 PASSED: EventSource library works correctly
✅ Test 2 PASSED: Bridge handles Claude Desktop protocol flow correctly

ALL TESTS PASSED ✅
```

### Manual Testing

**Test Bridge Directly**:
```bash
cd /home/jcornell/universal-cloud-connector
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | \
  server_url="http://127.0.0.1:3001/sse" \
  api_token="default-api-key" \
  node dist/index.js
```

**Test Server Health**:
```bash
for port in 3001 3002 3003 3004 3005; do
  echo "Port $port:"
  curl -s http://127.0.0.1:$port/health
done
```

---

## Deployment

### Docker Build
```bash
cd /home/jcornell/mcp-dev-environment
docker-compose build
docker-compose up -d
```

### Bridge Build
```bash
cd /home/jcornell/universal-cloud-connector
npm run build
```

### Claude Desktop Integration
1. Ensure all Docker containers running: `docker-compose ps`
2. Rebuild bridge: `npm run build`
3. Restart Claude Desktop (completely close and reopen)
4. Create new chat session
5. Tools should be available

---

## Performance Metrics

- SSE endpoint event: ~10-60ms
- Bridge request processing: <10ms
- Server response time: 50-500ms (varies by operation)
- Total end-to-end latency: ~100-600ms

---

## Related Documentation

- **Troubleshooting**: [../mcp-dev-environment/docs/TROUBLESHOOTING.md](../../mcp-dev-environment/docs/TROUBLESHOOTING.md)
- **Issues and Fixes**: [../mcp-dev-environment/docs/ISSUES_AND_FIXES_CONSOLIDATED.md](../../mcp-dev-environment/docs/ISSUES_AND_FIXES_CONSOLIDATED.md)
- **Lessons Learned**: [../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md](../../mcp-dev-environment/docs/LESSONS_LEARNED_CONSOLIDATED.md)
- **Setup Guide**: [../mcp-dev-environment/docs/SETUP_GUIDE.md](../../mcp-dev-environment/docs/SETUP_GUIDE.md)

---

## Change Log

### December 6, 2025
- Updated to reflect current production architecture
- Documented SSE endpoint race condition fix
- Documented GitHub wrapper per-session process fix
- Updated data flow examples
- Added comprehensive testing section
- Removed outdated deployment variant section (direct docker exec no longer used)
