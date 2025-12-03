#!/usr/bin/env node

import EventSource from "eventsource";
import { createReadStream, createWriteStream } from "fs";
import { stdin, stdout, stderr } from "process";

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

  constructor(serverUrl: string, apiToken: string) {
    this.serverUrl = serverUrl;
    this.apiToken = apiToken;
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
    if (this.serverUrl.endsWith("/sse")) {
      return this.serverUrl.replace(/\/sse$/, "/messages");
    }
    return `${this.serverUrl}/messages`;
  }

  public async sendRequest(payload: JSONRPCRequest): Promise<void> {
    const messagesUrl = this.getMessagesUrl();

    try {
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
      }
    } catch (error) {
      this.logError("Failed to send request to remote server", error);
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
      };

      this.eventSource.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as JSONRPCResponse;
          stdout.write(JSON.stringify(data) + "\n");
        } catch (error) {
          this.logError("Failed to parse SSE message", error);
        }
      };

      this.eventSource.onerror = (error: Event) => {
        this.logError("SSE connection error", error);

        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        if (this.shouldReconnect && this.retryCount < MAX_RETRIES) {
          this.retryCount++;
          const delay = RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1);
          this.logInfo(
            `Reconnecting in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})`
          );
          setTimeout(() => this.connectSSE(), delay);
        } else if (this.shouldReconnect) {
          this.logError(
            `Failed to connect after ${MAX_RETRIES} attempts. Giving up.`
          );
          this.shouldReconnect = false;
          process.exit(1);
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

          SERVER_URL = (config.server_url || process.env.server_url) as string;
          API_TOKEN = (config.api_token || process.env.api_token) as string;

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
          connector.start();

          // Send initialize response
          const response: JSONRPCResponse = {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "1.0",
              capabilities: {},
              serverInfo: {
                name: "universal-cloud-connector",
                version: "1.0.0"
              }
            }
          };
          stdout.write(JSON.stringify(response) + "\n");
        } else if (isInitialized && connector) {
          // After initialization, forward all requests to the connector
          connector.sendRequest(request as JSONRPCRequest).catch((error) => {
            stderr.write(`Error sending request: ${String(error)}\n`);
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
    if (connector) {
      connector.stop();
    }
    process.exit(0);
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
