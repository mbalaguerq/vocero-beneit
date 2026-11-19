"""Pont best-effort entre una reserva del CRM i l'agenda PHP."""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("nea.agenda_bridge")


class AgendaBridge:
    def __init__(self, base_url: str, token: str, client: httpx.AsyncClient | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._client = client

    async def create_request(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.base_url or not self.token:
            logger.warning("agenda bridge no configurat; reserva CRM conservada")
            return None
        own_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            response = await client.post(
                f"{self.base_url}/api/whatsapp/requests",
                json=payload,
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            )
            if response.status_code not in (200, 201):
                logger.error("agenda bridge HTTP %s", response.status_code)
                return None
            data = response.json()
            return data if isinstance(data, dict) else None
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("agenda bridge error: %s", exc)
            return None
        finally:
            if own_client:
                await client.aclose()
