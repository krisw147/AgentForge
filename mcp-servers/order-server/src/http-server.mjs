import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createOrderMcpServer } from "./server.mjs";


async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("请求体超过 1MB");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : undefined;
}


export function createOrderHttpServer() {
  return http.createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, {
        "Content-Type": "application/json"
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null
        })
      );
      return;
    }

    const mcpServer = createOrderMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    try {
      await mcpServer.connect(transport);
      const body = await readBody(request);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      console.error("streamable-http MCP error", error);
      if (!response.headersSent) {
        response.writeHead(error.statusCode ?? 500, {
          "Content-Type": "application/json"
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : "MCP error"
            },
            id: null
          })
        );
      }
    } finally {
      response.on("close", () => {
        transport.close();
        mcpServer.close();
      });
    }
  });
}


if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.MCP_HTTP_PORT || 8766);
  const host = process.env.MCP_HTTP_HOST || "127.0.0.1";
  createOrderHttpServer().listen(port, host, () => {
    console.error(
      JSON.stringify({
        service: "agentforge-order-http-mcp",
        status: "ready",
        host,
        port
      })
    );
  });
}

