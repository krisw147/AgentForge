FROM node:22-alpine

WORKDIR /app

COPY mcp-servers/order-server/package.json mcp-servers/order-server/package-lock.json ./order-server/
RUN cd order-server && npm ci --omit=dev
COPY mcp-servers/order-server ./order-server

COPY mcp-servers/order-bridge/package.json mcp-servers/order-bridge/package-lock.json ./order-bridge/
RUN cd order-bridge && npm ci --omit=dev
COPY mcp-servers/order-bridge ./order-bridge
COPY mcp-servers/bridge.config.json ./bridge.config.json

ENV MCP_BRIDGE_CONFIG=/app/bridge.config.json \
    MCP_BRIDGE_HOST=0.0.0.0 \
    MCP_BRIDGE_PORT=8765

EXPOSE 8765

CMD ["node", "/app/order-bridge/src/server.mjs"]
