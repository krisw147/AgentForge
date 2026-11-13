from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from ..config import settings


class MCPBridgeError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class MCPBridgeClient:
    def __init__(self) -> None:
        self.url = settings.mcp_bridge_url
        self.token = settings.mcp_bridge_token

    @property
    def enabled(self) -> bool:
        return settings.mcp_bridge_enabled

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.enabled:
            raise MCPBridgeError("MCP Bridge 尚未配置", status_code=503)
        try:
            with httpx.Client(timeout=20.0, trust_env=False) as client:
                response = client.request(
                    method,
                    f"{self.url}{path}",
                    headers={"X-Bridge-Token": self.token},
                    json=body,
                )
            if response.status_code >= 400:
                try:
                    detail = response.json().get("error")
                except ValueError:
                    detail = response.text
                raise MCPBridgeError(
                    detail or f"MCP Bridge 返回 {response.status_code}",
                    status_code=502,
                )
            return response.json()
        except MCPBridgeError:
            raise
        except Exception as exc:
            raise MCPBridgeError(f"MCP Bridge 连接失败：{exc}") from exc

    def list_servers(self) -> Dict[str, Any]:
        return self._request("GET", "/api/mcp/servers")

    def discover(self, bridge_server_id: str) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/mcp/servers/{bridge_server_id}/discover",
        )

    def health(self, bridge_server_id: str) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/mcp/servers/{bridge_server_id}/health",
        )

    def call(
        self,
        bridge_server_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/mcp/servers/{bridge_server_id}/tools/{tool_name}/call",
            {"arguments": arguments},
        )


mcp_bridge = MCPBridgeClient()
