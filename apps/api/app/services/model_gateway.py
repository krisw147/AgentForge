from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from ..config import settings


@dataclass
class ModelResponse:
    text: str
    input_tokens: int
    output_tokens: int
    provider: str


class ModelGateway:
    def __init__(self) -> None:
        self.provider = (
            f"openai-compatible:{settings.llm_model}"
            if settings.live_model_enabled
            else "demo-deterministic"
        )

    def compose_answer(
        self,
        user_prompt: str,
        facts: dict,
        fallback: str,
    ) -> ModelResponse:
        estimated_input = max(1, len(user_prompt + json.dumps(facts)) // 2)
        if not settings.live_model_enabled:
            return ModelResponse(
                text=fallback,
                input_tokens=estimated_input,
                output_tokens=max(1, len(fallback) // 2),
                provider=self.provider,
            )

        try:
            with httpx.Client(
                timeout=15.0, trust_env=settings.llm_trust_env
            ) as client:
                response = client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.llm_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.llm_model,
                        "temperature": 0.2,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "你是企业客服助手。只根据提供的事实作答，"
                                    "简洁、准确，不要编造订单或退款结果。"
                                ),
                            },
                            {
                                "role": "user",
                                "content": (
                                    f"用户请求：{user_prompt}\n"
                                    f"事实：{json.dumps(facts, ensure_ascii=False)}"
                                ),
                            },
                        ],
                    },
                )
            response.raise_for_status()
            body = response.json()
            usage = body.get("usage", {})
            text = body["choices"][0]["message"].get("content") or fallback
            return ModelResponse(
                text=text,
                input_tokens=usage.get("prompt_tokens", estimated_input),
                output_tokens=usage.get(
                    "completion_tokens", max(1, len(text) // 2)
                ),
                provider=self.provider,
            )
        except Exception:
            return ModelResponse(
                text=fallback,
                input_tokens=estimated_input,
                output_tokens=max(1, len(fallback) // 2),
                provider=f"{self.provider}:fallback",
            )

