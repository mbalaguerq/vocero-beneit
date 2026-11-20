"""Turno completo: handoff después de la despedida; LLM agotado → silencio + handoff error."""
from __future__ import annotations

import asyncio
import json

import httpx

from app.llm import LlmExhausted, LlmReply, ToolCall
from tests.conftest import CRM_URL, FakeLLM, mock_crm_basics, despachar


async def test_handoff_despedida_primero_pausa_despues(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    ctx.llm.replies = [
        LlmReply(
            content=None,
            tool_calls=[ToolCall(id="tc1", name="handoff", arguments={"reason": "pidió humano"})],
        ),
        LlmReply(content="Va — te paso con el equipo ahora mismo, sin que repitas nada."),
    ]
    await despachar(client, ctx, text="quiero hablar con una persona")
    await asyncio.sleep(0.25)

    assert routes["messages"].call_count == 1
    assert routes["handoff"].call_count == 1
    # ORDEN CRÍTICO: primero la despedida, luego el handoff (si no, 409 ai_paused)
    llamadas = [
        str(c.request.url.path) for c in respx_mock.calls if "/api/bot/" in str(c.request.url)
    ]
    assert llamadas.index("/api/bot/messages") < llamadas.index("/api/bot/handoff")
    body = json.loads(routes["handoff"].calls[0].request.content)
    # El texto libre del LLM se normaliza al catálogo del CRM (002): un
    # reason fuera de catálogo era 422 y el handoff se perdía en producción.
    assert body["reason"] == "cliente"


async def test_peticion_agenda_correcta_y_trasllat_pausa_ia(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    agenda = respx_mock.post(f"{CRM_URL}/api/bot/agenda-request").mock(
        return_value=httpx.Response(200, json={"requestId": "req_1"})
    )
    ctx.llm.replies = [
        LlmReply(
            content=None,
            tool_calls=[
                ToolCall(
                    id="tc_agenda",
                    name="create_agenda_request",
                    arguments={
                        "client_name": "Ana Pérez",
                        "phone": "+34600111222",
                        "address": "Carrer Major 1",
                        "work_type": "Reparació",
                        "description": "La caldera perd aigua.",
                    },
                )
            ],
        ),
        LlmReply(content="La petició està registrada; ho trasllado a l'equip."),
    ]
    await despachar(client, ctx, text="Vull reparar la caldera", esperar=True)

    assert agenda.call_count == 1
    assert routes["messages"].call_count == 1
    assert routes["handoff"].call_count == 1
    assert json.loads(routes["handoff"].calls[0].request.content)["reason"] == "modelo"
    paths = [str(c.request.url.path) for c in respx_mock.calls if "/api/bot/" in str(c.request.url)]
    assert paths.index("/api/bot/messages") < paths.index("/api/bot/handoff")


async def test_peticio_agenda_fallida_no_afirma_registre(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    respx_mock.post(f"{CRM_URL}/api/bot/agenda-request").mock(
        return_value=httpx.Response(500)
    )
    ctx.llm.replies = [
        LlmReply(
            content=None,
            tool_calls=[
                ToolCall(
                    id="tc_agenda_fail",
                    name="create_agenda_request",
                    arguments={
                        "client_name": "Ana Pérez",
                        "phone": "+34600111222",
                        "address": "Carrer Major 1",
                        "work_type": "Reparació",
                        "description": "La caldera perd aigua.",
                    },
                )
            ],
        ),
        LlmReply(content="La petición ya está registrada y el equipo te llamará."),
    ]
    await despachar(client, ctx, text="Vull reparar la caldera", esperar=True)

    text = json.loads(routes["messages"].calls[0].request.content)["text"]
    assert "registrar la petición" in text
    assert "registrada" not in text
    assert routes["handoff"].call_count == 1
    assert json.loads(routes["handoff"].calls[0].request.content)["reason"] == "error"


async def test_llm_agotado_silencio_mas_handoff_error(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    ctx.llm.raise_exc = LlmExhausted("proveedor caído")

    resp = await despachar(client, ctx, text="hola")
    assert resp.status_code == 200  # el despacho JAMÁS falla por el LLM
    await asyncio.sleep(0.25)

    assert routes["messages"].call_count == 0  # nada roto al lead
    assert routes["handoff"].call_count == 1
    body = json.loads(routes["handoff"].calls[0].request.content)
    assert body["reason"] == "error"


async def test_turno_programa_seguimiento(ctx, client, respx_mock):
    mock_crm_basics(respx_mock)
    await despachar(client, ctx, text="hola")
    await asyncio.sleep(0.2)
    conv = next(iter(ctx.store.conversations.values()))
    assert conv.greeted is True
    assert conv.followup_due_at is not None  # empujón agendado a FOLLOWUP_HOURS


async def test_turno_con_route_out_cierra_sin_seguimiento(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    ctx.llm.replies = [
        LlmReply(content=None, tool_calls=[ToolCall(id="t1", name="route_out", arguments={})]),
        LlmReply(content="Por ahora no somos el mejor fit — te dejo unos recursos para arrancar por tu cuenta."),
    ]
    await despachar(client, ctx, text="soy estudiante")
    await asyncio.sleep(0.25)
    assert routes["messages"].call_count == 1
    ficha = json.loads(routes["ficha"].calls[0].request.content)
    assert ficha["ficha"]["resultado"] == "dio_diy"
    conv = next(iter(ctx.store.conversations.values()))
    assert conv.phase == "cerrada"
    assert conv.followup_due_at is None


async def test_los_turnos_de_una_conversacion_no_se_encinan(ctx, client, respx_mock):
    """Un mensaje que llega tarde NO abre un turno con el contexto de antes.

    Dos mensajes con segundos de diferencia: el segundo abría su propio turno
    mientras el primero seguía corriendo, así que la cita se reservaba sin
    haber leído el mensaje que la corregía y salían dos respuestas encimadas.
    """
    routes = mock_crm_basics(respx_mock)

    class LlmLento(FakeLLM):
        async def complete(self, messages, tools=None):
            await asyncio.sleep(0.3)
            return await super().complete(messages, tools)

    ctx.llm = LlmLento()

    await despachar(client, ctx, text="Si 10.30", wamid="wamid.a")
    await asyncio.sleep(0.15)  # el turno A ya arrancó y sigue en el LLM
    await despachar(client, ctx, text="De mañana", wamid="wamid.b")
    await asyncio.sleep(1.2)

    assert routes["messages"].call_count == 2  # una respuesta por turno...
    rutas = [
        str(c.request.url.path)
        for c in respx_mock.calls
        if str(c.request.url.path) in ("/api/bot/context", "/api/bot/messages")
    ]
    # ...y el turno B lee el contexto DESPUÉS de que A mandó la suya: si no,
    # decide sobre un estado que ya cambió.
    assert rutas.count("/api/bot/context") == 2
    assert rutas.index("/api/bot/messages") < rutas.index(
        "/api/bot/context", rutas.index("/api/bot/context") + 1
    )


async def test_el_texto_junto_a_una_herramienta_no_se_da_por_dicho(ctx, client, respx_mock):
    """GLM escribe el mensaje Y llama la herramienta en la misma respuesta.

    Con ese texto a la vista en la ronda siguiente, el modelo lo daba por
    enviado y contestaba relleno («¡Éxito con tus ventas! 🙌»), que era lo
    único que le llegaba al lead. Producción, aishiagency, 18 sep 2026.
    """
    routes = mock_crm_basics(respx_mock)
    ctx.llm.replies = [
        LlmReply(
            content="Anoto eso 👌",  # preámbulo: NO debe salir ni quedar como dicho
            tool_calls=[
                ToolCall(id="t1", name="update_ficha", arguments={"rubro": "inmobiliario"}),
                ToolCall(id="t2", name="route_out", arguments={}),
            ],
        ),
        LlmReply(content="Esta campaña es para agencias de servicios digitales, así que por ahora no encaja. ¡Éxito con tus ventas!"),
    ]
    await despachar(client, ctx, text="solo vendo propiedades")
    await asyncio.sleep(0.25)

    textos = [json.loads(c.request.content)["text"] for c in routes["messages"].calls]
    assert textos == ["Esta campaña es para agencias de servicios digitales, así que por ahora no encaja. ¡Éxito con tus ventas!"]
    llamada_herramientas = ctx.llm.calls[1]["messages"][-3]
    assert llamada_herramientas["role"] == "assistant" and llamada_herramientas["tool_calls"]
    assert llamada_herramientas["content"] is None
    assert routes["ficha"].call_count == 2  # las herramientas sí corrieron


async def test_no_repite_palabra_por_palabra_un_mensaje_ya_enviado(ctx, client, respx_mock):
    """El saludo del principio a media conversación: se le pide otra."""
    routes = mock_crm_basics(respx_mock)
    saludo = "¡Hola Guillermo! Soy Nea, de AISHIA. Para ubicarte rápido, ¿qué servicio vendes tú?"
    ctx.llm.replies = [LlmReply(content=saludo)]
    await despachar(client, ctx, text="hola", wamid="wamid.r1")
    await asyncio.sleep(0.25)

    ctx.llm.replies = [
        LlmReply(content=saludo),
        LlmReply(content="Entendido: solo vendes propiedades. Esta campaña no encaja contigo."),
    ]
    await despachar(client, ctx, text="solo vendo casas", wamid="wamid.r2")
    await asyncio.sleep(0.25)

    textos = [json.loads(c.request.content)["text"] for c in routes["messages"].calls]
    assert textos == [saludo, "Entendido: solo vendes propiedades. Esta campaña no encaja contigo."]
    correccion = ctx.llm.calls[-1]["messages"][-1]
    assert correccion["role"] == "system" and "palabra por palabra" in correccion["content"]


async def test_una_nota_interna_no_le_llega_al_lead(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    ctx.llm.replies = [
        LlmReply(content="(Registro actualizado — conversación cerrada con salida digna.)"),
        LlmReply(content="Tienes razón, disculpa la repetición. ¡Éxito con tus ventas!"),
    ]
    await despachar(client, ctx, text="me repetiste lo mismo")
    await asyncio.sleep(0.25)

    textos = [json.loads(c.request.content)["text"] for c in routes["messages"].calls]
    assert textos == ["Tienes razón, disculpa la repetición. ¡Éxito con tus ventas!"]


async def test_si_la_segunda_tambien_sale_mal_silencio_y_handoff(ctx, client, respx_mock):
    routes = mock_crm_basics(respx_mock)
    ctx.llm.replies = [
        LlmReply(content="(nota interna)"),
        LlmReply(content="[otra nota]"),
    ]
    await despachar(client, ctx, text="hola")
    await asyncio.sleep(0.25)

    assert routes["messages"].call_count == 0
    assert routes["handoff"].call_count == 1
    assert json.loads(routes["handoff"].calls[0].request.content)["reason"] == "error"
