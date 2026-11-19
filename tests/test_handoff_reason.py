"""Normalización del handoff.reason al catálogo cerrado del CRM (002).

El LLM escribe motivos libres; el CRM valida un enum. La certificación cazó
en vivo el 422 que perdía el handoff — post_handoff normaliza SIEMPRE.
"""
from __future__ import annotations

import json

import httpx

from app.crm import CrmClient, canonical_handoff_reason
from tests.conftest import CRM_URL


def test_canonicos_pasan_tal_cual():
    for r in ("cliente", "modelo", "error", "ventana", "hostilidad"):
        assert canonical_handoff_reason(r) == r


def test_texto_libre_del_llm_se_normaliza():
    assert canonical_handoff_reason("pidió humano") == "cliente"
    assert canonical_handoff_reason("El lead quiere hablar con una persona") == "cliente"
    assert canonical_handoff_reason("lead_request") == "cliente"
    assert canonical_handoff_reason("hostilidad sostenida del lead") == "hostilidad"
    assert canonical_handoff_reason("groserías escalantes") == "hostilidad"
    assert canonical_handoff_reason("error del proveedor") == "error"
    assert canonical_handoff_reason("duda fuera de mis hechos") == "modelo"
    assert canonical_handoff_reason(None) == "modelo"
    assert canonical_handoff_reason("") == "modelo"


async def test_post_handoff_manda_el_reason_normalizado(respx_mock):
    route = respx_mock.post(f"{CRM_URL}/api/bot/handoff").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    crm = CrmClient(CRM_URL, "k")
    await crm.post_handoff("cv_1", "pidió humano")
    await crm.aclose()
    body = json.loads(route.calls[0].request.content)
    assert body == {"conversationId": "cv_1", "reason": "cliente"}