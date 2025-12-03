#!/usr/bin/env node

/**
 * Example MCP Server for Testing Universal Cloud Connector
 *
 * This is a minimal Express server that demonstrates how to implement
 * an SSE-based MCP server compatible with the Universal Cloud Connector.
 *
 * Usage:
 *   node TEST_SERVER_EXAMPLE.js
 *
 * Then configure Universal Connector with:
 *   server_url: "http://localhost:3000/sse"
 *   api_token: "test-token-123"
 */

import express from 'express';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'test-token-123';

// Track connected SSE clients
const sseClients = new Set();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Authentication middleware
 * Validates Bearer token in Authorization header
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token || token !== API_TOKEN) {
    console.log(`  ✗ Unauthorized (token: ${token})`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: `Invalid or missing token. Expected: Bearer ${API_TOKEN}`
    });
  }

  console.log('  ✓ Authorized');
  next();
};

app.use(authMiddleware);

/**
 * SSE Endpoint - /sse
 *
 * Accepts GET requests and returns Server-Sent Events stream.
 * The Universal Connector connects here with EventSource to receive responses.
 *
 * Flow:
 * 1. Client connects with GET /sse
 * 2. Server responds with Content-Type: text/event-stream
 * 3. Server sends events as: data: <JSON-RPC response>\n\n
 * 4. Client (Universal Connector) writes events to stdout
 */
app.get('/sse', (req, res) => {
  console.log('  → SSE connection opened');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Add to active clients set
  sseClients.add(res);

  // Send initial connected message
  const connectionMsg = {
    jsonrpc: '2.0',
    id: randomUUID(),
    result: {
      status: 'connected',
      timestamp: new Date().toISOString(),
      connectedClients: sseClients.size
    }
  };
  res.write(`data: ${JSON.stringify(connectionMsg)}\n\n`);

  // Keep-alive interval (prevents timeouts)
  const keepAliveInterval = setInterval(() => {
    res.write(': keep-alive\n');
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    console.log('  ← SSE connection closed');
    sseClients.delete(res);
    clearInterval(keepAliveInterval);
    res.end();
  });

  // Handle client error
  req.on('error', (error) => {
    console.log(`  ! SSE error: ${error.message}`);
    sseClients.delete(res);
    clearInterval(keepAliveInterval);
    res.end();
  });
});

/**
 * Messages Endpoint - /messages
 *
 * Accepts POST requests with JSON-RPC requests from Universal Connector.
 *
 * Flow:
 * 1. Universal Connector receives request from Claude
 * 2. Connector POSTs request to /messages
 * 3. Server processes request
 * 4. Server sends response via SSE (to connected clients)
 *    OR returns HTTP response
 */
app.post('/messages', (req, res) => {
  const request = req.body;
  console.log(`  → Request: ${request.method} (id: ${request.id})`);

  // Validate JSON-RPC format
  if (!request.jsonrpc || request.jsonrpc !== '2.0') {
    const error = {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32600,
        message: 'Invalid Request',
        data: 'Missing or invalid jsonrpc field'
      }
    };
    console.log(`  ✗ Invalid JSON-RPC format`);
    return res.status(400).json(error);
  }

  // Acknowledge receipt
  res.status(200).json({
    jsonrpc: '2.0',
    id: request.id,
    result: { status: 'received', timestamp: new Date().toISOString() }
  });

  // Simulate async processing and broadcast response via SSE
  // In real implementation, you'd process the request and send actual results
  setTimeout(() => {
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        method: request.method,
        processed: true,
        timestamp: new Date().toISOString(),
        message: `Echo of request: ${JSON.stringify(request.params || {})}`,
        connectedClients: sseClients.size
      }
    };

    // Broadcast to all connected SSE clients
    for (const client of sseClients) {
      client.write(`data: ${JSON.stringify(response)}\n\n`);
    }
    console.log(`  ← Response sent: ${response.method} (id: ${response.id})`);
  }, 100);
});

/**
 * Health Check Endpoint
 *
 * Used to verify the server is running without authentication
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedClients: sseClients.size
  });
});

/**
 * Stats Endpoint
 *
 * Shows server statistics (requires auth)
 */
app.get('/stats', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedSSEClients: sseClients.size,
    apiToken: API_TOKEN,
    port: PORT
  });
});

/**
 * 404 Handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: [
      { method: 'GET', path: '/sse', description: 'SSE stream for responses' },
      { method: 'POST', path: '/messages', description: 'Receive JSON-RPC requests' },
      { method: 'GET', path: '/health', description: 'Health check (no auth)' },
      { method: 'GET', path: '/stats', description: 'Server statistics (auth required)' }
    ]
  });
});

/**
 * Error Handler
 */
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

/**
 * Start Server
 */
const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         MCP Test Server - Universal Connector Test          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('🔌 Endpoints:');
  console.log(`   GET  /sse              → SSE stream for responses`);
  console.log(`   POST /messages         → JSON-RPC request handler`);
  console.log(`   GET  /health           → Health check (no auth required)`);
  console.log(`   GET  /stats            → Server statistics`);
  console.log('');
  console.log('🔐 Authentication:');
  console.log(`   Bearer Token: ${API_TOKEN}`);
  console.log(`   Usage: Authorization: Bearer ${API_TOKEN}`);
  console.log('');
  console.log('🎯 Universal Connector Configuration:');
  console.log(`   server_url: http://localhost:${PORT}/sse`);
  console.log(`   api_token:  ${API_TOKEN}`);
  console.log('');
  console.log('💡 Test Commands:');
  console.log(`   curl http://localhost:${PORT}/health`);
  console.log(`   curl -H "Authorization: Bearer ${API_TOKEN}" http://localhost:${PORT}/stats`);
  console.log('');
  console.log('📝 To test with Universal Connector:');
  console.log('   1. Start this server (already running)');
  console.log('   2. Configure Claude Desktop with:');
  console.log(`      "server_url": "http://localhost:${PORT}/sse"`);
  console.log(`      "api_token": "${API_TOKEN}"`);
  console.log('   3. Send a message to Claude');
  console.log('   4. Check the logs below for activity');
  console.log('');
  console.log('📊 Activity Log:');
  console.log('');
});

/**
 * Graceful Shutdown
 */
process.on('SIGINT', () => {
  console.log('\n');
  console.log('🛑 Shutting down gracefully...');

  // Close all SSE connections
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();

  server.close(() => {
    console.log('✓ Server stopped');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.log('⚠ Forced exit');
    process.exit(1);
  }, 5000);
});

/**
 * Example JSON-RPC Request Format
 *
 * Request from Universal Connector:
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/list",
 *   "params": {}
 * }
 *
 * Response from this server:
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "result": {
 *     "method": "tools/list",
 *     "processed": true,
 *     "timestamp": "2025-12-03T...",
 *     "message": "Echo of request: {}",
 *     "connectedClients": 1
 *   }
 * }
 */
