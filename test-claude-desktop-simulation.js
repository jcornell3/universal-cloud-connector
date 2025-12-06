#!/usr/bin/env node

/**
 * Test that simulates Claude Desktop's protocol flow
 *
 * Claude Desktop behavior (from actual logs):
 * 1. Spawns bridge as subprocess
 * 2. IMMEDIATELY sends initialize request via stdin (before SSE establishes)
 * 3. Expects initialize response back via stdout
 * 4. Continues to send requests via stdin
 * 5. Receives responses via stdout
 *
 * This test replicates that exact flow to diagnose the race condition.
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:3001/sse';
const API_TOKEN = process.env.API_TOKEN || 'default-api-key';

console.log('=== Claude Desktop Protocol Flow Simulation ===');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`API Token: ${API_TOKEN}`);
console.log('');

// Track test state
const testState = {
  bridgeStarted: false,
  initializeReceived: false,
  toolsListReceived: false,
  errors: [],
  startTime: Date.now()
};

// Spawn the bridge as a subprocess (like Claude Desktop does)
const bridge = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    server_url: SERVER_URL,
    api_token: API_TOKEN
  },
  stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
});

console.log('[TEST] Bridge subprocess spawned');
testState.bridgeStarted = true;

// Handle stdout (JSON-RPC responses)
let stdoutBuffer = '';
bridge.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() || ''; // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const response = JSON.parse(line);
      const elapsed = Date.now() - testState.startTime;

      console.log(`[STDOUT +${elapsed}ms] Response received:`, JSON.stringify(response));

      // Track which responses we've received
      if (response.id === 1) {
        testState.initializeReceived = true;
        console.log('[TEST] ✅ Initialize response received');
      } else if (response.id === 2) {
        testState.toolsListReceived = true;
        console.log('[TEST] ✅ Tools/list response received');
      }

      // Check for errors
      if (response.error) {
        console.log(`[TEST] ❌ Error in response: ${response.error.message}`);
        testState.errors.push(response.error);
      }
    } catch (error) {
      console.log(`[STDOUT] Non-JSON output: ${line}`);
    }
  }
});

// Handle stderr (logs from bridge)
bridge.stderr.on('data', (chunk) => {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const elapsed = Date.now() - testState.startTime;
    console.log(`[STDERR +${elapsed}ms] ${line}`);

    // Track critical events
    if (line.includes('SSE connection established')) {
      console.log('[TEST] 📡 SSE connection established');
    }
    if (line.includes('[ENDPOINT-EVENT]')) {
      console.log('[TEST] 🎯 Endpoint event received');
    }
    if (line.includes('Session ID extracted')) {
      console.log('[TEST] 🔑 Session ID extracted');
    }
    if (line.includes('Session ID ready')) {
      console.log('[TEST] ✅ Session ID ready for use');
    }
    if (line.includes('ERROR')) {
      console.log('[TEST] ❌ Error detected in stderr');
    }
  }
});

// Handle bridge exit
bridge.on('exit', (code, signal) => {
  console.log(`[TEST] Bridge exited with code ${code}, signal ${signal}`);
  printTestSummary();
  process.exit(code || 0);
});

// Send initialize request IMMEDIATELY (like Claude Desktop does)
// This is the key race condition - initialize arrives before SSE establishes
const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  }
};

console.log('[TEST] Sending initialize request IMMEDIATELY (replicating Claude Desktop behavior)');
bridge.stdin.write(JSON.stringify(initializeRequest) + '\n');
const initializeSentTime = Date.now() - testState.startTime;
console.log(`[STDIN +${initializeSentTime}ms] Initialize request sent`);

// Wait 3 seconds, then send tools/list request
setTimeout(() => {
  const toolsListRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  };

  console.log('[TEST] Sending tools/list request');
  bridge.stdin.write(JSON.stringify(toolsListRequest) + '\n');
  const toolsListSentTime = Date.now() - testState.startTime;
  console.log(`[STDIN +${toolsListSentTime}ms] Tools/list request sent`);
}, 3000);

// Test timeout - if we don't get responses within 15 seconds, something is wrong
const testTimeout = setTimeout(() => {
  console.log('\n[TEST] ⏱️  Test timeout after 15 seconds');
  console.log('[TEST] Bridge did not respond in expected timeframe');
  printTestSummary();

  bridge.kill('SIGTERM');

  setTimeout(() => {
    if (!bridge.killed) {
      console.log('[TEST] Force killing bridge');
      bridge.kill('SIGKILL');
    }
    process.exit(1);
  }, 2000);
}, 15000);

// Success condition - if we get both responses within timeout, end test successfully
const checkSuccess = setInterval(() => {
  if (testState.initializeReceived && testState.toolsListReceived) {
    console.log('\n[TEST] ✅ All responses received successfully!');
    clearTimeout(testTimeout);
    clearInterval(checkSuccess);

    printTestSummary();

    bridge.kill('SIGTERM');

    setTimeout(() => {
      if (!bridge.killed) {
        bridge.kill('SIGKILL');
      }
      process.exit(0);
    }, 1000);
  }
}, 100);

function printTestSummary() {
  const elapsed = Date.now() - testState.startTime;
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Total elapsed time: ${elapsed}ms`);
  console.log(`Bridge started: ${testState.bridgeStarted ? '✅' : '❌'}`);
  console.log(`Initialize response: ${testState.initializeReceived ? '✅' : '❌'}`);
  console.log(`Tools/list response: ${testState.toolsListReceived ? '✅' : '❌'}`);
  console.log(`Errors encountered: ${testState.errors.length}`);

  if (testState.errors.length > 0) {
    console.log('\nErrors:');
    testState.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. ${err.message}`);
    });
  }

  console.log('');
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n[TEST] Received SIGINT, cleaning up...');
  clearTimeout(testTimeout);
  clearInterval(checkSuccess);
  bridge.kill('SIGTERM');
  setTimeout(() => {
    if (!bridge.killed) {
      bridge.kill('SIGKILL');
    }
    process.exit(130);
  }, 1000);
});
