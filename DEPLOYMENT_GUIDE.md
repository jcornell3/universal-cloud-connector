# Universal Cloud Connector - Deployment & Setup Guide

Complete guide to deploying the Universal Cloud Connector (.mcpb) with Claude Desktop.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Building from Source](#building-from-source)
3. [Installing in Claude Desktop](#installing-in-claude-desktop)
4. [Configuration Examples](#configuration-examples)
5. [Troubleshooting](#troubleshooting)
6. [Advanced Setup](#advanced-setup)

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Claude Desktop (latest version with .mcpb support)

### 30-Second Setup

```bash
# 1. Clone the repository
git clone https://github.com/anthropics/mcp.git
cd universal-cloud-connector

# 2. Build the bundle
npm install
npm run package

# 3. Copy the bundle to Claude Desktop
# macOS:
cp universal-cloud-connector.mcpb ~/Library/Application\ Support/Claude/extensions/

# Windows (PowerShell):
Copy-Item universal-cloud-connector.mcpb "$env:APPDATA\Claude\extensions\"

# Linux:
cp universal-cloud-connector.mcpb ~/.config/Claude/extensions/
```

## Building from Source

### Step 1: Install Dependencies

```bash
npm install
```

This installs:
- `eventsource`: For SSE (Server-Sent Events) connection
- `@types/eventsource`: TypeScript type definitions
- `@types/node`: Node.js type definitions
- `typescript`: TypeScript compiler

### Step 2: Build TypeScript

```bash
npm run build
```

Output: Compiled JavaScript in `dist/` directory
- `dist/index.js` - Main connector code
- `dist/index.js.map` - Source maps for debugging
- `dist/index.d.ts` - Type declarations

### Step 3: Create Bundle

```bash
npm run package
```

Output: `universal-cloud-connector.mcpb` (8KB compressed archive)

The bundle contains:
```
universal-cloud-connector.mcpb
├── manifest.json      (Configuration schema)
├── package.json       (Metadata)
├── dist/              (Compiled code)
├── README.md          (Documentation)
└── LICENSE            (MIT License)
```

## Installing in Claude Desktop

### Platform-Specific Instructions

#### macOS

```bash
# 1. Find Claude Desktop config location
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

# 2. Get absolute path to bundle
realpath universal-cloud-connector.mcpb

# 3. Edit the config (or create if missing)
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add or update the `mcpServers` section:

```json
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
```

4. Restart Claude Desktop (⌘Q then reopen)

#### Windows (PowerShell)

```powershell
# 1. Find config
$configPath = "$env:APPDATA\Claude\claude_desktop_config.json"
type $configPath

# 2. Copy bundle to extensions (create dir if needed)
$extensionsDir = "$env:APPDATA\Claude\extensions"
New-Item -ItemType Directory -Force -Path $extensionsDir
Copy-Item universal-cloud-connector.mcpb $extensionsDir\

# 3. Get absolute path
(Resolve-Path "universal-cloud-connector.mcpb").Path

# 4. Edit config
notepad $configPath
```

Add to configuration:

```json
{
  "mcpServers": {
    "universal-connector": {
      "bundlePath": "C:\\Users\\YourUsername\\AppData\\Roaming\\Claude\\extensions\\universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://your-server.com/sse",
        "api_token": "your-bearer-token"
      }
    }
  }
}
```

5. Restart Claude Desktop

#### Linux

```bash
# 1. Find config
cat ~/.config/Claude/claude_desktop_config.json

# 2. Copy bundle
mkdir -p ~/.config/Claude/extensions
cp universal-cloud-connector.mcpb ~/.config/Claude/extensions/

# 3. Get absolute path
realpath universal-cloud-connector.mcpb

# 4. Edit config
nano ~/.config/Claude/claude_desktop_config.json
```

Add to configuration:

```json
{
  "mcpServers": {
    "universal-connector": {
      "bundlePath": "/home/username/.config/Claude/extensions/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://your-server.com/sse",
        "api_token": "your-bearer-token"
      }
    }
  }
}
```

5. Restart Claude Desktop

## Configuration Examples

### Example 1: VPS with Self-Hosted MCP Server

```json
{
  "mcpServers": {
    "my-vps-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://my-vps.example.com:3000/sse",
        "api_token": "sk_live_abc123def456..."
      }
    }
  }
}
```

### Example 2: Cloudflare Workers

```json
{
  "mcpServers": {
    "cloudflare-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://my-worker.my-domain.workers.dev/sse",
        "api_token": "bearer_token_from_cloudflare"
      }
    }
  }
}
```

### Example 3: Local Docker Container

```json
{
  "mcpServers": {
    "docker-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "http://mcp-server:3000/sse",
        "api_token": "local-dev-token"
      }
    }
  }
}
```

### Example 4: GitHub-Hosted Endpoint

```json
{
  "mcpServers": {
    "github-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://gh-pages.example.com/mcp/sse",
        "api_token": "github-personal-access-token"
      }
    }
  }
}
```

### Example 5: Multiple Servers

```json
{
  "mcpServers": {
    "production-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://prod.example.com/sse",
        "api_token": "prod-token"
      }
    },
    "staging-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "https://staging.example.com/sse",
        "api_token": "staging-token"
      }
    },
    "local-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "http://localhost:3000/sse",
        "api_token": "local-token"
      }
    }
  }
}
```

## Troubleshooting

### Issue: "SSE connection error"

**Possible Causes:**
1. Server URL is incorrect or unreachable
2. Bearer token is invalid or expired
3. Server is not running or has connectivity issues
4. Firewall is blocking the connection

**Solutions:**
```bash
# 1. Test connectivity to the server
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-server.com/sse

# 2. Check if server is running
ssh your-server.com
systemctl status mcp-server

# 3. Review Claude Desktop logs
# macOS:
tail -f ~/Library/Logs/Claude Desktop/

# Windows:
Get-Content "$env:APPDATA\Claude\Logs\*" -Tail 50

# Linux:
tail -f ~/.local/share/Claude/logs/*
```

### Issue: "POST request failed with status 401"

**Cause:** Invalid or expired Bearer token

**Solution:**
1. Regenerate the API token on your server
2. Update the configuration in `claude_desktop_config.json`
3. Restart Claude Desktop

### Issue: "Failed to parse SSE message"

**Cause:** Remote server is sending invalid JSON-RPC format

**Solution:**
1. Verify the remote server is sending valid JSON-RPC 2.0 format
2. Check server logs for errors
3. Ensure Content-Type is `application/json`

Example valid response from server:
```json
data: {"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}
```

### Issue: Bundle fails to load

**Causes:**
1. Invalid bundle path in configuration
2. Bundle is corrupted
3. Node.js version mismatch

**Solutions:**
```bash
# 1. Verify bundle exists and is readable
ls -l /path/to/universal-cloud-connector.mcpb

# 2. Check bundle contents
tar -tzf universal-cloud-connector.mcpb

# 3. Verify Node.js version
node --version  # Should be 18 or higher

# 4. Rebuild the bundle
npm run clean
npm run package
```

## Advanced Setup

### Setting Up a Remote MCP Server

Complete example Node.js server:

```javascript
// mcp-server.js
import express from 'express';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'dev-token';

// Middleware
app.use(express.json());

// Authentication middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use(authMiddleware);

// SSE endpoint - sends responses to Claude
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  console.log('[SSE] Client connected');

  // Send initial connection message
  const connectMsg = {
    jsonrpc: '2.0',
    id: randomUUID(),
    result: { status: 'connected', version: '1.0' }
  };
  res.write(`data: ${JSON.stringify(connectMsg)}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n');
  }, 30000);

  req.on('close', () => {
    console.log('[SSE] Client disconnected');
    clearInterval(keepAlive);
    res.end();
  });
});

// Messages endpoint - receives requests from Claude
app.post('/messages', (req, res) => {
  const request = req.body;
  console.log('[Messages] Received:', request.method, request.id);

  // Echo back the request for demo
  const response = {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      method: request.method,
      received: new Date().toISOString(),
      echo: request.params
    }
  };

  // Send response via SSE (in real implementation)
  // For now, just return HTTP response
  res.json(response);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(PORT, () => {
  console.log(`MCP Server running on http://localhost:${PORT}`);
  console.log(`  SSE Endpoint: http://localhost:${PORT}/sse`);
  console.log(`  Messages Endpoint: http://localhost:${PORT}/messages`);
  console.log(`  API Token: ${API_TOKEN}`);
});
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy your MCP server code
COPY . .

# Install dependencies
RUN npm install --production

# Expose port
EXPOSE 3000

# Set environment
ENV PORT=3000
ENV API_TOKEN=your-token-here

# Start server
CMD ["node", "mcp-server.js"]
```

```bash
# Build and run
docker build -t mcp-server .
docker run -p 3000:3000 -e API_TOKEN=my-token mcp-server
```

### Using with Environment Variables

Instead of hardcoding tokens, use environment variables:

```bash
# .env file (DO NOT commit this)
UNIVERSAL_CONNECTOR_URL=https://my-server.com/sse
UNIVERSAL_CONNECTOR_TOKEN=sk_live_abc123...
```

Then configure Claude:

```json
{
  "mcpServers": {
    "universal-connector": {
      "bundlePath": "/path/to/universal-cloud-connector.mcpb",
      "config": {
        "server_url": "${UNIVERSAL_CONNECTOR_URL}",
        "api_token": "${UNIVERSAL_CONNECTOR_TOKEN}"
      }
    }
  }
}
```

## Security Best Practices

1. **Use HTTPS Only**: Always use `https://` for production servers
2. **Rotate Tokens**: Regularly rotate your API tokens
3. **Secure Config**: Never commit `claude_desktop_config.json` with real tokens
4. **Limited Scope**: Create API tokens with minimal required permissions
5. **Monitor**: Set up logging and monitoring on your MCP server
6. **Firewall**: Restrict access to your MCP server by IP if possible

## Support

- Check [README.md](README.md) for general documentation
- Review the [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification)
- See [MCP Documentation](https://modelcontextprotocol.io/)
- Check Claude Desktop logs for detailed error messages

## Version Information

- **Universal Cloud Connector**: 1.0.0
- **MCP Protocol Version**: 1.0
- **Node.js Minimum**: 18.0.0
- **Last Updated**: 2025-12
