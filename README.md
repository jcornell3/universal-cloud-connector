# Universal Cloud Connector

A universal MCP Bundle (.mcpb) that connects Claude Desktop to any remote SSE-based MCP server.

## Overview

The Universal Cloud Connector is a generic "driver" that allows Claude Desktop to communicate with MCP servers hosted on:
- Virtual Private Servers (VPS)
- Cloudflare Workers
- GitHub Actions
- Docker containers
- Any server with SSE (Server-Sent Events) support

## Architecture

```
Claude Desktop
     ↓
  stdin/stdout
     ↓
Universal Connector (Node.js process)
     ↓
  SSE Connection (EventSource)
  HTTP POST (axios)
     ↓
Remote MCP Server
```

### Communication Flow

1. **Downstream (SSE)**: Remote server sends responses via Server-Sent Events
2. **Upstream (HTTP POST)**: Connector receives requests from Claude via stdin and POSTs them to the remote server

## Configuration

The connector is configured via the `manifest.json` with two required fields:

### Configuration Parameters

- **server_url** (Required): Full URL to the SSE endpoint
  - Example: `https://my-vps.com/sse`
  - If path ends with `/sse`, messages are POSTed to `/messages`
  - Otherwise, `/messages` is appended to the URL

- **api_token** (Required): Bearer token for authentication
  - Sent as: `Authorization: Bearer <api_token>`
  - Treated as a password field in configuration UI

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- Claude Desktop (with .mcpb support)

### Build Steps

```bash
# 1. Clone or download the project
cd universal-cloud-connector

# 2. Install dependencies
npm install

# 3. Build the TypeScript code
npm run build

# 4. Create the .mcpb bundle
npm run package

# Output: universal-cloud-connector.mcpb
```

### Install in Claude Desktop

1. **Locate Claude Desktop config directory:**
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. **Add the connector to your config:**
   ```json
   {
     "mcpServers": {
       "universal-connector": {
         "bundlePath": "/path/to/universal-cloud-connector.mcpb",
         "config": {
           "server_url": "https://your-server.com/sse",
           "api_token": "your-bearer-token-here"
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop**

## Project Structure

```
universal-cloud-connector/
├── manifest.json          # MCP bundle manifest with configuration schema
├── package.json           # Node.js package configuration
├── tsconfig.json          # TypeScript compiler configuration
├── README.md              # This file
├── LICENSE                # MIT License
├── src/
│   └── index.ts           # Main connector implementation
├── dist/                  # Compiled JavaScript (generated)
├── scripts/
│   └── create-bundle.sh   # Bundle creation script
└── universal-cloud-connector.mcpb  # Final bundle (generated)
```

## Development

### Commands

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run directly (requires env vars)
export server_url="https://my-server.com/sse"
export api_token="my-token"
npm start

# Run with ts-node (development)
npm run dev

# Create the .mcpb bundle
npm run package
```

### Environment Variables

- `server_url`: SSE endpoint URL (e.g., `https://my-server.com/sse`)
- `api_token`: Bearer token for authentication

### Logging

All diagnostic messages are written to stderr:
- Connection events
- Retry attempts
- Error messages
- Configuration info

JSON-RPC messages are written to stdout.

## Features

### SSE Connection Management

- Automatic reconnection with exponential backoff
- Configurable retry strategy (max 5 attempts)
- Connection state tracking
- Graceful error handling

### Request/Response Processing

- Bidirectional JSON-RPC 2.0 communication
- Header-based authentication (Bearer token)
- Automatic URL routing:
  - `/sse` endpoint for responses (downstream)
  - `/messages` endpoint for requests (upstream)

### Error Handling

- Connection failures with detailed logging
- Automatic retry mechanism (1s, 2s, 4s, 8s, 16s delays)
- Graceful shutdown on repeated failures
- Invalid JSON handling with error logging

## Remote Server Requirements

Your remote MCP server must support:

1. **SSE Endpoint** (`/sse` or configured path):
   - Accept HTTP GET or OPTIONS requests
   - Send Server-Sent Events with JSON-RPC responses
   - Accept `Authorization: Bearer <token>` header

2. **Messages Endpoint** (`/messages` relative to SSE URL):
   - Accept HTTP POST requests
   - Receive JSON-RPC requests as request body
   - Accept `Authorization: Bearer <token>` header
   - Return JSON-RPC responses

Example headers expected:
```
Authorization: Bearer <your-api-token>
Accept: text/event-stream
Content-Type: application/json
```

## Example: Connecting to a Custom MCP Server

### Step 1: Create Your Remote Server

Create an Express.js server with SSE support:

```javascript
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3000;
const API_TOKEN = 'your-secret-token';

// Middleware for auth
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// SSE endpoint - sends responses
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial response
  const response = {
    jsonrpc: '2.0',
    id: 1,
    result: { status: 'connected' }
  };
  res.write(`data: ${JSON.stringify(response)}\n\n`);

  // Keep connection alive
  const interval = setInterval(() => {
    res.write(': keep-alive\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// Messages endpoint - receives requests
app.post('/messages', express.json(), (req, res) => {
  const jsonRpcRequest = req.body;
  console.log('Received:', jsonRpcRequest);

  // Process the request...
  const response = {
    jsonrpc: '2.0',
    id: jsonRpcRequest.id,
    result: { processed: true }
  };

  res.json(response);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### Step 2: Deploy and Configure

1. Deploy the server (e.g., to a VPS or Cloudflare Workers)
2. Get your server URL: `https://your-server.com/sse`
3. Get your bearer token
4. Configure the Universal Connector with these values

## Troubleshooting

### Connection Issues

**Problem**: "SSE connection error"
- Check that `server_url` is correct and accessible
- Verify the Bearer token is valid
- Ensure the remote server is running
- Check firewall/CORS settings

**Problem**: "Reconnecting in Xms"
- This is normal - the connector will retry automatically
- Check server logs for errors
- Verify API token hasn't expired

### Message Routing

**Problem**: "POST request failed"
- Verify `/messages` endpoint exists on remote server
- Check that POST endpoint accepts same token
- Ensure `Content-Type: application/json` is accepted

### Debugging

Enable debug logging by monitoring stderr:

```bash
npm start 2>&1 | tee debug.log
```

Look for:
- SSE connection established/closed
- Message parsing errors
- Retry attempts
- Request failures

## Performance Considerations

- SSE connection is persistent (not polling)
- Exponential backoff prevents server overload during outages
- JSON parsing happens in-process (minimal overhead)
- No database or external state storage required

## Security

- **Bearer Token**: Treat as a secret - never commit to version control
- **HTTPS**: Always use HTTPS for production servers
- **Authentication**: Tokens are sent with every request/connection
- **No Credential Storage**: Tokens stored only in Claude Desktop config

## License

MIT License - See LICENSE file for details

## Support

For issues or feature requests:
1. Check the troubleshooting section
2. Review the [MCP Documentation](https://modelcontextprotocol.io/)
3. Open an issue on GitHub

## Version

- **Current**: 1.0.0
- **MCP Version**: 1.0
- **Node.js**: 18+
- **Last Updated**: 2025-12

## Related Resources

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Server-Sent Events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification)
- [Claude Desktop Config](https://github.com/anthropics/claude-desktop)
