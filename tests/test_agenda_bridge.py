from __future__ import annotations

import httpx
import pytest

from app.agenda_bridge import AgendaBridge


@pytest.mark.asyncio
async def test_agenda_bridge_envia_peticio(respx_mock):
    ruta = respx_mock.post("https://proves.example/api/whatsapp/requests").mock(
        return_value=httpx.Response(201, json={"ok": True, "duplicate": False})
    )
    resultat = await AgendaBridge("https://proves.example", "t" * 32).create_request(
        {"sourceEventId": "booking-1", "clientName": "Prova"}
    )
    assert resultat == {"ok": True, "duplicate": False}
    assert ruta.calls[0].request.headers["Authorization"] == "Bearer " + "t" * 32


@pytest.mark.asyncio
async def test_agenda_bridge_error_http_no_trenca_la_reserva(respx_mock):
    respx_mock.post("https://proves.example/api/whatsapp/requests").mock(
        return_value=httpx.Response(503)
    )
    assert await AgendaBridge("https://proves.example", "t" * 32).create_request({}) is None


@pytest.mark.asyncio
async def test_agenda_bridge_repeticio_conserva_la_clau_idempotent(respx_mock):
    ruta = respx_mock.post("https://proves.example/api/whatsapp/requests").mock(
        return_value=httpx.Response(200, json={"ok": True, "duplicate": True})
    )
    payload = {"sourceEventId": "booking-1"}
    await AgendaBridge("https://proves.example", "t" * 32).create_request(payload)
    resultat = await AgendaBridge("https://proves.example", "t" * 32).create_request(payload)
    assert resultat == {"ok": True, "duplicate": True}
    assert [r.request.content for r in ruta.calls] == [b'{"sourceEventId":"booking-1"}'] * 2
