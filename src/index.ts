#!/usr/bin/env node

import EventSource from "eventsource";
import { createReadStream, createWriteStream } from "fs";
import { stdin, stdout, stderr } from "process";
import { randomUUID } from "crypto";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;

// Configuration will be set from initialize request
let SERVER_URL: string | null = null;
let API_TOKEN: string | null = null;

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

class UniversalConnector {
  private serverUrl: string;
  private apiToken: string;
  private eventSource: EventSource | null = null;
  private retryCount = 0;
  private shouldReconnect = true;
  private pendingRequests: Map<string | number, JSONRPCRequest> = new Map();
  private lastMessageTime = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Set<string> = new Set(); // Track processed messages to prevent duplicates
  private sessionId: string | null = null; // Session ID from SSE endpoint event
  private sessionIdReceived = false; // Flag to track if session_id has been received

  constructor(serverUrl: string, apiToken: string) {
    this.serverUrl = serverUrl;
    this.apiToken = apiToken;
    this.lastMessageTime = Date.now();
  }

  private async waitForSessionId(): Promise<void> {
    // Wait until sessionId has been received
    // Use a simple polling approach to avoid promise reference issues
    let attempts = 0;
    while (!this.sessionIdReceived && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms
      attempts++;
    }
    if (!this.sessionIdReceived) {
      this.logError("Timeout waiting for session_id from server");
      // FALLBACK: If server didn't send endpoint event, generate a session_id ourselves
      // This handles servers that don't properly implement SSE endpoint event
      this.sessionId = randomUUID();
      this.logInfo(`FALLBACK: Generated session_id for server that didn't send endpoint event: ${this.sessionId}`);
      this.sessionIdReceived = true;
    }
  }

  private logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    stderr.write(
      `[${timestamp}] ERROR: ${message}${errorMessage ? ` - ${errorMessage}` : ""}\n`
    );
  }

  private logInfo(message: string): void {
    const timestamp = new Date().toISOString();
    stderr.write(`[${timestamp}] INFO: ${message}\n`);
  }

  private getMessagesUrl(): string {
    let messagesUrl: string;
    if (this.serverUrl.endsWith("/sse")) {
      messagesUrl = this.serverUrl.replace(/\/sse$/, "/messages");
    } else {
      messagesUrl = `${this.serverUrl}/messages`;
    }

    // Add session_id as query parameter if available (snake_case to match Python MCP SDK)
    if (this.sessionId) {
      const url = new URL(messagesUrl);
      url.searchParams.set("session_id", this.sessionId);
      return url.toString();
    }

    return messagesUrl;
  }

  public async sendRequest(payload: JSONRPCRequest): Promise<void> {
    // CRITICAL: Wait for session_id to be received before sending any requests
    // This prevents race conditions where requests are sent before endpoint event is processed
    await this.waitForSessionId();

    const messagesUrl = this.getMessagesUrl();

    try {
      // NOTE: Request ID tracking is now handled by the caller (main) BEFORE calling this function
      // This ensures the ID is tracked synchronously before the async HTTP request begins
      // Do NOT add request ID tracking here to avoid race conditions

      const response = await fetch(messagesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logError(
          `POST request failed with status ${response.status}`,
          await response.text()
        );
        // Note: Don't delete from pendingRequests here - let the caller handle cleanup on error
      }
    } catch (error) {
      this.logError("Failed to send request to remote server", error);
      // Note: Don't delete from pendingRequests here - let the caller handle cleanup on error
    }
  }

  private connectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      this.logInfo(`Connecting to SSE endpoint: ${this.serverUrl}`);

      const eventSourceInitDict: Record<string, unknown> = {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "text/event-stream",
        },
      };

      this.eventSource = new EventSource(this.serverUrl, eventSourceInitDict);

      this.eventSource.onopen = () => {
        this.logInfo("SSE connection established");
        this.retryCount = 0;
        // Clear processed message cache on new connection to avoid blocking valid retries
        this.processedMessageIds.clear();
        // Reset session ID on new connection (will be sent by server in endpoint event)
        this.sessionId = null;
        // Reset the sessionIdReceived flag on new connection
        this.sessionIdReceived = false;
      };

      // CRITICAL: Handle the 'endpoint' event which contains the session_id
      // EventSource uses addEventListener for named events like 'endpoint'
      this.eventSource.addEventListener("endpoint", (event: any) => {
        const endpointData = event.data;
        this.logInfo(`[DEBUG] Received 'endpoint' event with data: ${endpointData}`);
        // Extract session_id from: /messages?session_id=<HEX> (Python MCP SDK sends UUID.hex format - 32 hex chars)
        const match = endpointData.match(/session_id=([a-f0-9]{32})/);
        if (match) {
          this.sessionId = match[1];
          this.logInfo(`CRITICAL: Session ID extracted from endpoint event: ${this.sessionId}`);
          // Signal that session_id is ready for use
          this.sessionIdReceived = true;
        } else {
          this.logError("Endpoint event received but no session_id found", endpointData);
        }
      });

      // Debug all SSE events
      this.eventSource.addEventListener("error", (event: any) => {
        this.logInfo(`[DEBUG] Received 'error' event: ${JSON.stringify(event)}`);
      });

      // Catch all events with custom event listener
      const originalAddEventListener = this.eventSource.addEventListener;
      this.eventSource.addEventListener = function(eventName: string, listener: any) {
        if (eventName !== "message" && eventName !== "error" && eventName !== "open" && eventName !== "close") {
          console.error(`[DEBUG] EventSource received named event: ${eventName}`);
        }
        originalAddEventListener.call(this, eventName, listener);
      };

      this.eventSource.onmessage = (event: MessageEvent) => {
        this.lastMessageTime = Date.now();

        try {
          const data = JSON.parse(event.data) as JSONRPCResponse;
          this.logInfo(`[DEBUG-ONMESSAGE] Raw event data: ${event.data.substring(0, 100)}`);

          // Only forward valid JSON-RPC responses (must have either result or error, and an id)
          if ((data.result !== undefined || data.error !== undefined) && data.id !== undefined) {
            // Create a unique key for this message to detect duplicates
            const messageKey = `${data.id}:${JSON.stringify(data)}`;
            this.logInfo(`[DEBUG-DEDUP] Created messageKey for id ${data.id}. Cache size: ${this.processedMessageIds.size}`);

            // Check if we've already processed this exact message
            if (this.processedMessageIds.has(messageKey)) {
              this.logInfo(`[DEBUG-SSE] Duplicate message received for id ${data.id}, skipping`);
              return;
            }

            // Mark this message as processed
            this.logInfo(`[DEBUG-DEDUP] Adding messageKey for id ${data.id} to cache`);
            this.processedMessageIds.add(messageKey);
            // Clear old entries to prevent memory leak (keep only recent 1000)
            if (this.processedMessageIds.size > 1000) {
              const entriesToDelete = this.processedMessageIds.size - 1000;
              let deleted = 0;
              for (const key of this.processedMessageIds) {
                if (deleted >= entriesToDelete) break;
                this.processedMessageIds.delete(key);
                deleted++;
              }
            }

            // Check if this response matches any pending request
            this.logInfo(`[DEBUG-SSE] Received response for id ${data.id}. pendingRequests has ${this.pendingRequests.size} entries. Keys: ${Array.from(this.pendingRequests.keys()).join(", ")}`);
            if (this.pendingRequests.has(data.id)) {
              // This is a response to one of our pending requests - forward it
              stdout.write(JSON.stringify(data) + "\n");
              this.pendingRequests.delete(data.id);
            } else {
              // Response id doesn't match any pending request - log and skip
              this.logInfo(`Received response for unmatched request id: ${data.id}`);
            }
          } else {
            // Log non-JSON-RPC messages to stderr, don't forward to stdout
            this.logInfo(`Received non-RPC message from SSE: ${JSON.stringify(data)}`);
          }
        } catch (error) {
          this.logError("Failed to parse SSE message", error);
        }
      };

      this.eventSource.onerror = (error: Event) => {
        const readyState = this.eventSource?.readyState ?? -1;
        this.logError(`SSE connection error (readyState: ${readyState})`, error);

        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        // Always try to reconnect if shouldReconnect is true, unless we've exhausted retries
        if (this.shouldReconnect && this.retryCount < MAX_RETRIES) {
          this.retryCount++;
          const delay = RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
          this.logInfo(
            `Reconnecting in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})`
          );
          setTimeout(() => this.connectSSE(), delay);
        } else if (this.shouldReconnect && this.retryCount >= MAX_RETRIES) {
          this.logError(
            `Failed to connect after ${MAX_RETRIES} attempts. Giving up.`
          );
          this.shouldReconnect = false;
          // Don't exit immediately - let the MCP protocol handle disconnection
          // process.exit(1);
        }
      };
    } catch (error) {
      this.logError("Failed to create SSE connection", error);
      if (this.shouldReconnect && this.retryCount < MAX_RETRIES) {
        this.retryCount++;
        const delay = RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
        setTimeout(() => this.connectSSE(), delay);
      }
    }
  }

  private setupStdinListener(): void {
    let buffer = "";

    stdin.setEncoding("utf-8");

    stdin.on("data", (chunk: string) => {
      buffer += chunk;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const payload = JSON.parse(line) as JSONRPCRequest;
            this.sendRequest(payload).catch((error) =>
              this.logError("Error sending request", error)
            );
          } catch (error) {
            this.logError("Failed to parse stdin JSON", error);
          }
        }
      }
    });

    stdin.on("end", () => {
      this.logInfo("stdin closed, shutting down");
      this.shouldReconnect = false;
      if (this.eventSource) {
        this.eventSource.close();
      }
      process.exit(0);
    });

    stdin.on("error", (error) => {
      this.logError("stdin error", error);
      process.exit(1);
    });
  }

  public start(): void {
    this.logInfo("Universal Cloud Connector starting");
    this.logInfo(`Server URL: ${this.serverUrl}`);
    this.logInfo(`Messages URL: ${this.getMessagesUrl()}`);

    // Don't call setupStdinListener here - main() will handle stdin
    this.connectSSE();
  }

  public stop(): void {
    this.logInfo("Universal Cloud Connector stopping");
    this.shouldReconnect = false;
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

async function main(): Promise<void> {
  let buffer = "";
  let connector: UniversalConnector | null = null;
  let isInitialized = false;

  stdin.setEncoding("utf-8");

  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line) as JSONRPCRequest;

        // Handle initialize request to get configuration
        if (!isInitialized && request.method === "initialize") {
          // Extract config from initialize params
          const params = request.params as Record<string, unknown>;
          const config = params.initializationOptions as Record<string, unknown> || {};

          // Try both lowercase and uppercase environment variable names
          SERVER_URL = (config.server_url || process.env.server_url || process.env.SERVER_URL) as string;
          API_TOKEN = (config.api_token || process.env.api_token || process.env.API_TOKEN) as string;

          if (!SERVER_URL || !API_TOKEN) {
            stderr.write("ERROR: server_url and api_token must be provided in config or environment\n");
            const errorResponse: JSONRPCResponse = {
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32002,
                message: "Server not initialized",
                data: "Missing server_url or api_token configuration"
              }
            };
            stdout.write(JSON.stringify(errorResponse) + "\n");
            process.exit(1);
          }

          isInitialized = true;
          connector = new UniversalConnector(SERVER_URL, API_TOKEN);

          // Add initialize id to pending requests BEFORE starting
          if (request.id !== undefined) {
            connector["pendingRequests"].set(request.id, request);
          }

          connector.start();

          // Forward the initialize request to the connector/bridge
          // The response will come back via SSE and be forwarded by the connector
          connector.sendRequest(request as JSONRPCRequest).catch((error) => {
            stderr.write(`Error sending initialize request: ${String(error)}\n`);
          });
        } else if (isInitialized && connector) {
          // After initialization, forward all requests to the connector
          // CRITICAL: Add request to pending BEFORE sending to avoid race condition
          // where response arrives before request is added to pendingRequests
          if (request.id !== undefined) {
            connector["pendingRequests"].set(request.id, request);
            stderr.write(`[DEBUG] Added request id ${request.id} to pendingRequests. Map size: ${connector["pendingRequests"].size}\n`);
          }

          connector.sendRequest(request as JSONRPCRequest).catch((error) => {
            stderr.write(`Error sending request: ${String(error)}\n`);
            // Clean up on error
            if (request.id !== undefined && connector) {
              connector["pendingRequests"].delete(request.id);
            }
          });
        } else if (!isInitialized) {
          // Not ready yet, send error
          const errorResponse: JSONRPCResponse = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32002,
              message: "Server not initialized"
            }
          };
          stdout.write(JSON.stringify(errorResponse) + "\n");
        }
      } catch (error) {
        stderr.write(`Failed to parse JSON: ${String(error)}\n`);
      }
    }
  });

  stdin.on("end", () => {
    // Don't exit when stdin ends - Claude Desktop keeps the subprocess alive
    // and will continue sending requests. Just log it for debugging.
    stderr.write(`[${new Date().toISOString()}] DEBUG: stdin closed but continuing\n`);
  });

  stdin.on("error", (error) => {
    stderr.write(`stdin error: ${String(error)}\n`);
    process.exit(1);
  });
}

main().catch((error) => {
  stderr.write(`FATAL ERROR in main: ${String(error)}\n`);
  process.exit(1);
});
