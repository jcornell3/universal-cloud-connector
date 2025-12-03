# Universal Cloud Connector - Quick Reference

## 🚀 What You Get

A production-ready MCP Bundle (.mcpb) that connects Claude Desktop to any remote SSE-based MCP server.

## 📦 Bundle Contents

```
universal-cloud-connector.mcpb (8KB)
├── manifest.json              ← Configuration schema
├── dist/index.js              ← Compiled connector code
├── package.json               ← Metadata
├── README.md                  ← Full documentation
└── LICENSE                    ← MIT license
```

## ⚡ 30-Second Start

```bash
# Build
npm install && npm run package

# Install (macOS)
cp universal-cloud-connector.mcpb ~/Library/Application\ Support/Claude/extensions/

# Configure (add to claude_desktop_config.json)
{
  "mcpServers": {
    "universal-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://your-server.com/sse",
        "api_token": "your-bearer-token"
      }
    }
  }
}

# Restart Claude Desktop
```

## 🔧 How It Works

```
Claude Desktop (stdin/stdout)
         ↓
Universal Connector
         ↓
  ┌─────────────┐
  │   SSE Conn  │ ← Receives responses
  │  (GET/SSE)  │
  └─────────────┘
         ↓
  Remote MCP Server
         ↑
  ┌─────────────┐
  │  POST /msg  │ ← Sends requests
  └─────────────┘
```

### Communication Paths

**Downstream (Response):**
- Remote server → GET `/sse` → SSE events → stdout → Claude

**Upstream (Request):**
- Claude → stdin → POST `/messages` → remote server

## 🎯 Configuration Fields

| Field | Type | Required | Example |
|-------|------|----------|---------|
| `server_url` | string | ✓ | `https://my-server.com/sse` |
| `api_token` | string | ✓ | `sk_live_abc123...` |

### URL Routing Logic

- If `server_url` ends with `/sse`:
  - **Downstream:** `https://my-server.com/sse`
  - **Upstream:** `https://my-server.com/messages`

- Otherwise:
  - **Downstream:** `https://my-server.com/sse` (append `/sse`)
  - **Upstream:** `https://my-server.com/sse/messages` (append `/messages`)

## 📋 File Manifest

```
universal-cloud-connector/
├── manifest.json              ← Bundle metadata & schema
├── package.json               ← Dependencies & scripts
├── tsconfig.json              ← TypeScript config
├── README.md                  ← Full documentation
├── DEPLOYMENT_GUIDE.md        ← Setup instructions
├── QUICK_REFERENCE.md         ← This file
├── LICENSE                    ← MIT license
├── .gitignore                 ← Git ignore rules
├── src/
│   └── index.ts               ← Main connector code (TypeScript)
├── dist/                      ← Compiled output
│   ├── index.js               ← Compiled code
│   ├── index.js.map           ← Source map
│   └── index.d.ts             ← Type definitions
├── scripts/
│   └── create-bundle.sh       ← Bundle creation script
├── node_modules/              ← Dependencies
└── universal-cloud-connector.mcpb  ← Final bundle
```

## 🛠️ Available Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Development (with ts-node)
npm run dev

# Start connector (requires env vars)
npm start

# Create bundle
npm run package

# Full workflow
npm install && npm run package
```

## 🔌 Connection Lifecycle

1. **Initialize**: Connector reads `server_url` and `api_token` from environment
2. **Validate**: Checks both parameters exist
3. **Connect SSE**: Opens EventSource to `server_url`
4. **Listen stdin**: Waits for JSON-RPC requests from Claude
5. **Route Requests**: POSTs requests to `/messages` endpoint
6. **Handle Responses**: Sends SSE events to stdout
7. **Auto-Reconnect**: Exponential backoff on connection loss (1s, 2s, 4s, 8s, 16s)
8. **Graceful Shutdown**: Closes on stdin EOF or fatal errors

## 📊 Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "SSE connection error" | Server unavailable | Check URL, firewall, server status |
| "POST request failed 401" | Invalid token | Regenerate and update token |
| "Failed to parse" | Invalid JSON | Verify server sends valid JSON-RPC |
| "env var not set" | Missing config | Add config to claude_desktop_config.json |

## 🔐 Security Checklist

- [ ] Use HTTPS for production servers
- [ ] Never commit real tokens to git
- [ ] Rotate tokens regularly
- [ ] Use strong, unique tokens
- [ ] Restrict server access by IP if possible
- [ ] Monitor server logs for suspicious activity
- [ ] Keep Node.js and dependencies updated

## 📝 JSON-RPC Message Format

### Request (Claude → Server)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

### Response (Server → Claude)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [...]
  }
}
```

## 🌐 Remote Server Requirements

Your server must:

1. **Accept GET/OPTIONS on `/sse`**
   - Return SSE stream with JSON-RPC responses
   - Accept `Authorization: Bearer <token>`
   - Accept `Accept: text/event-stream`

2. **Accept POST on `/messages`**
   - Receive JSON-RPC requests
   - Accept `Authorization: Bearer <token>`
   - Return JSON response

3. **Keep-alive support**
   - Periodically send keep-alive comments (`: keep-alive\n`)
   - Hold connection open for event streaming

## 🚀 Quick Deploy Examples

### Local Docker

```bash
docker run -p 3000:3000 \
  -e API_TOKEN=local-token \
  my-mcp-server

# Configure with
"server_url": "http://localhost:3000/sse"
```

### Cloudflare Worker

```bash
wrangler deploy

# Configure with
"server_url": "https://my-worker.my-domain.workers.dev/sse"
```

### VPS/EC2

```bash
# SSH and start server
ssh user@server.com
node mcp-server.js &

# Configure with
"server_url": "https://server.com/sse"
```

## 📞 Support

- **Documentation**: See [README.md](README.md) and [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- **Logs**: Check stderr for connection/error messages
- **Issues**: Review troubleshooting section in DEPLOYMENT_GUIDE.md
- **Specs**: [MCP Documentation](https://modelcontextprotocol.io/)

## 📌 Key Features

✅ **Universal**: Works with any SSE-based MCP server
✅ **Robust**: Automatic reconnection with exponential backoff
✅ **Simple**: Single configuration with server URL + token
✅ **Lightweight**: 8KB bundle, minimal dependencies
✅ **Secure**: Bearer token authentication on all requests
✅ **Open Source**: MIT licensed, community-driven

## 🔄 Example Flow

```
1. Claude sends JSON-RPC request via stdin
   {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}

2. Connector parses request

3. Connector POSTs to https://my-server.com/messages
   Headers: Authorization: Bearer sk_live_abc123...
   Body: {"jsonrpc":"2.0","id":1,...}

4. Remote server receives request

5. Remote server sends response via SSE to /sse endpoint
   data: {"jsonrpc":"2.0","id":1,"result":{...}}

6. Connector receives SSE event

7. Connector writes to stdout
   {"jsonrpc":"2.0","id":1,"result":{...}}

8. Claude receives response
```

## 📦 Version

- **Universal Cloud Connector**: 1.0.0
- **MCP Protocol**: 1.0
- **Node.js**: 18+
- **Dependencies**: eventsource@2.0.2, eventsource types

---

**Ready to connect?** Start with [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)!
