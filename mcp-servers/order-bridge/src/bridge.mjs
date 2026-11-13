import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";


const IDLE_SESSION_MS = 5 * 60 * 1000;


function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 超时（${timeoutMs}ms）`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}


export async function loadConfig(configPath) {
  const absolutePath = resolve(configPath);
  const config = JSON.parse(await readFile(absolutePath, "utf8"));
  const baseDir = dirname(absolutePath);
  const expandEnv = (value) => {
    if (typeof value !== "string") return value;
    return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_match, key, fallback) => {
      return process.env[key] ?? fallback ?? "";
    });
  };
  return {
    ...config,
    servers: config.servers.map((server) => ({
      ...server,
      cwd: server.cwd
        ? (isAbsolute(server.cwd)
            ? server.cwd
            : resolve(baseDir, server.cwd))
        : undefined,
      url: expandEnv(server.url),
      timeoutMs: server.timeoutMs ?? 12000
    }))
  };
}


function findServer(config, serverId) {
  const server = config.servers.find((item) => item.id === serverId);
  if (!server) {
    const error = new Error(`MCP Server 不存在：${serverId}`);
    error.statusCode = 404;
    throw error;
  }
  return server;
}


function safeChildEnv(server) {
  const allowedKeys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME"
  ];
  const env = {};
  for (const key of allowedKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...(server.env ?? {}) };
}


function resolveHeaders(server) {
  const headers = {};
  for (const [header, envName] of Object.entries(server.headerEnv ?? {})) {
    const value = process.env[envName];
    if (value) headers[header] = value;
  }
  return headers;
}


class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.queues = new Map();
    this.cleanupTimer = setInterval(
      () => this.cleanupIdleSessions(),
      60 * 1000
    );
    this.cleanupTimer.unref?.();
  }

  async connect(server) {
    let transport;
    let stderrText = "";
    if (server.transport === "streamable-http") {
      if (!server.url) throw new Error(`MCP Server ${server.id} 缺少 URL`);
      transport = new StreamableHTTPClientTransport(
        new URL(server.url),
        {
          requestInit: { headers: resolveHeaders(server) },
          redirectPolicy: "same-origin",
          reconnectionOptions: {
            initialReconnectionDelay: 500,
            maxReconnectionDelay: 5000,
            reconnectionDelayGrowFactor: 1.5,
            maxRetries: 2
          }
        }
      );
    } else if (server.transport === "stdio" || !server.transport) {
      transport = new StdioClientTransport({
        command:
          server.command === "node" ? process.execPath : server.command,
        args: server.args ?? [],
        cwd: server.cwd,
        env: safeChildEnv(server),
        stderr: "pipe"
      });
      transport.stderr?.on("data", (chunk) => {
        if (stderrText.length < 12000) {
          stderrText += chunk.toString("utf8");
        }
      });
    } else {
      throw new Error(`不支持的 MCP transport：${server.transport}`);
    }

    const client = new Client(
      {
        name: "agentforge-mcp-bridge",
        version: "0.2.0"
      },
      { capabilities: {} }
    );
    try {
      await withTimeout(
        client.connect(transport),
        server.timeoutMs,
        "MCP initialize"
      );
    } catch (error) {
      await client.close().catch(() => undefined);
      const stderr = stderrText.trim();
      if (stderr) {
        error.message = `${error.message}；MCP stderr：${stderr.slice(-1000)}`;
      }
      throw error;
    }
    return { client, lastUsedAt: Date.now(), stderrText };
  }

  async withSession(server, callback) {
    const previous = this.queues.get(server.id) ?? Promise.resolve();
    let release;
    const current = new Promise((resolveCurrent) => {
      release = resolveCurrent;
    });
    this.queues.set(server.id, previous.then(() => current));
    await previous;
    try {
      let entry = this.sessions.get(server.id);
      if (!entry) {
        entry = await this.connect(server);
        this.sessions.set(server.id, entry);
      }
      entry.lastUsedAt = Date.now();
      return await callback(entry);
    } catch (error) {
      await this.invalidate(server.id);
      throw error;
    } finally {
      release();
    }
  }

  async invalidate(serverId) {
    const entry = this.sessions.get(serverId);
    this.sessions.delete(serverId);
    if (entry) await entry.client.close().catch(() => undefined);
  }

  cleanupIdleSessions() {
    const cutoff = Date.now() - IDLE_SESSION_MS;
    for (const [serverId, entry] of this.sessions) {
      if (entry.lastUsedAt < cutoff) {
        this.invalidate(serverId).catch(() => undefined);
      }
    }
  }

  async closeAll() {
    clearInterval(this.cleanupTimer);
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((serverId) => this.invalidate(serverId)));
  }
}


export async function discoverServer(sessions, config, serverId) {
  const server = findServer(config, serverId);
  const startedAt = performance.now();
  return sessions.withSession(server, async ({ client }) => {
    const result = await withTimeout(
      client.listTools(),
      server.timeoutMs,
      "MCP tools/list"
    );
    return {
      serverId: server.id,
      serverName: server.name,
      transport: server.transport || "stdio",
      latencyMs: Math.round(performance.now() - startedAt),
      tools: result.tools.map((tool) => {
        const annotations = tool.annotations ?? {};
        return {
          name: tool.name,
          title: tool.title ?? tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema ?? {},
          outputSchema: tool.outputSchema ?? null,
          readOnly: annotations.readOnlyHint === true,
          destructive: annotations.destructiveHint === true,
          idempotent: annotations.idempotentHint === true,
          requiresApproval:
            annotations.destructiveHint === true ||
            (server.requiresApproval ?? []).includes(tool.name)
        };
      })
    };
  });
}


export async function checkServer(sessions, config, serverId) {
  const server = findServer(config, serverId);
  const startedAt = performance.now();
  return sessions.withSession(server, async ({ client }) => {
    await withTimeout(client.ping(), server.timeoutMs, "MCP ping");
    return {
      serverId: server.id,
      status: "healthy",
      latencyMs: Math.round(performance.now() - startedAt)
    };
  });
}


export async function callServerTool(
  sessions,
  config,
  serverId,
  toolName,
  toolArguments
) {
  const server = findServer(config, serverId);
  if (!(server.allowedTools ?? []).includes(toolName)) {
    const error = new Error(`工具不在白名单中：${toolName}`);
    error.statusCode = 403;
    throw error;
  }
  const startedAt = performance.now();
  return sessions.withSession(server, async ({ client }) => {
    const result = await withTimeout(
      client.callTool({
        name: toolName,
        arguments: toolArguments
      }),
      server.timeoutMs,
      `MCP tools/call ${toolName}`
    );
    return {
      serverId: server.id,
      toolName,
      ok: result.isError !== true,
      isError: result.isError === true,
      latencyMs: Math.round(performance.now() - startedAt),
      content: result.content ?? [],
      structuredContent: result.structuredContent ?? null
    };
  });
}


export function createBridgeServer({ config, token, logger = console }) {
  const sessions = new SessionManager(config);
  const server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const send = (status, body) => {
      response.statusCode = status;
      response.end(JSON.stringify(body));
    };

    if (request.url === "/health") {
      return send(200, {
        status: "ok",
        service: "agentforge-mcp-bridge",
        servers: config.servers.length,
        activeSessions: sessions.sessions.size
      });
    }
    if (request.headers["x-bridge-token"] !== token) {
      return send(401, { error: "MCP Bridge Token 无效" });
    }

    try {
      if (
        request.method === "GET" &&
        request.url === "/api/mcp/servers"
      ) {
        return send(200, {
          servers: config.servers.map((item) => ({
            id: item.id,
            name: item.name,
            transport: item.transport || "stdio",
            allowedTools: item.allowedTools ?? [],
            requiresApproval: item.requiresApproval ?? []
          }))
        });
      }

      const discoverMatch = request.url?.match(
        /^\/api\/mcp\/servers\/([^/]+)\/discover$/
      );
      if (request.method === "POST" && discoverMatch) {
        const result = await discoverServer(
          sessions,
          config,
          decodeURIComponent(discoverMatch[1])
        );
        return send(200, result);
      }

      const healthMatch = request.url?.match(
        /^\/api\/mcp\/servers\/([^/]+)\/health$/
      );
      if (request.method === "POST" && healthMatch) {
        const result = await checkServer(
          sessions,
          config,
          decodeURIComponent(healthMatch[1])
        );
        return send(200, result);
      }

      const callMatch = request.url?.match(
        /^\/api\/mcp\/servers\/([^/]+)\/tools\/([^/]+)\/call$/
      );
      if (request.method === "POST" && callMatch) {
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
        const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : {};
        const result = await callServerTool(
          sessions,
          config,
          decodeURIComponent(callMatch[1]),
          decodeURIComponent(callMatch[2]),
          body.arguments ?? {}
        );
        return send(200, result);
      }
      return send(404, { error: "接口不存在" });
    } catch (error) {
      logger.error(error);
      return send(error.statusCode ?? 500, {
        error: error instanceof Error ? error.message : "MCP Bridge 调用失败"
      });
    }
  });
  server.on("close", () => {
    sessions.closeAll().catch(() => undefined);
  });
  return server;
}
