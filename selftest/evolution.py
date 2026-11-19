"""Cliente Evolution v2 para pruebas de comportamiento en el canal real.

Manda WhatsApp REALES desde una línea tester TUYA hacia el número donde corre
el bot. Por eso las reglas viven AQUÍ, en el cliente, y no en el guion:

- Pausa mínima de {MIN_PAUSE_SECONDS} s entre envíos (la impone `_guard`,
  no la buena voluntad del guion). Además deja cerrar el coalesce del bot.
- Tope duro de {MAX_MESSAGES_PER_RUN} mensajes salientes por corrida: al
  llegar, `BudgetExhausted` — la corrida se parte en dos, jamás se spamea.
- Kill-switch: si existe el archivo `STOP_LIVE_RUN` en la raíz del repo del
  bot, el siguiente envío aborta con `LiveRunAborted`. El operador (o cualquier
  sesión) puede crearlo en cualquier momento para frenar todo en seco.
- Un solo destino: `LIVE_TARGET_NUMBER` del .env. No hay parámetro para
  mandar a otro número — a propósito.

Credenciales: EVOLUTION_BASE_URL / EVOLUTION_INSTANCE / EVOLUTION_APIKEY
(o EVOLUTION_API_KEY) / LIVE_TARGET_NUMBER, leídas del `.env` del repo (o del
`.env` del directorio padre). Jamás en el código ni en logs.
"""
from __future__ import annotations

import base64
import mimetypes
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
KILL_SWITCH = REPO_ROOT / "STOP_LIVE_RUN"
ENV_CANDIDATES = (REPO_ROOT / ".env", REPO_ROOT.parent / ".env")

MIN_PAUSE_SECONDS = 8.0
MAX_MESSAGES_PER_RUN = 40


class LiveRunAborted(RuntimeError):
    """Kill-switch activado: existe STOP_LIVE_RUN — no se envía nada más."""


class BudgetExhausted(RuntimeError):
    """Se alcanzó el tope de mensajes de la corrida — continuar en otra."""


def load_env() -> dict[str, str]:
    vals: dict[str, str] = {}
    for candidate in ENV_CANDIDATES:
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals.setdefault(k.strip(), v.strip())
    return vals


@dataclass
class EvolutionClient:
    base_url: str
    instance: str
    apikey: str
    target: str
    sent: int = 0
    _last_send: float = field(default=0.0, repr=False)

    @classmethod
    def from_env(cls) -> "EvolutionClient":
        env = load_env()
        base = env.get("EVOLUTION_BASE_URL", "").rstrip("/")
        key = env.get("EVOLUTION_APIKEY") or env.get("EVOLUTION_API_KEY") or ""
        instance = env.get("EVOLUTION_INSTANCE", "")
        target = env.get("LIVE_TARGET_NUMBER", "")
        faltan = [
            n
            for n, v in [
                ("EVOLUTION_BASE_URL", base),
                ("EVOLUTION_APIKEY", key),
                ("EVOLUTION_INSTANCE", instance),
                ("LIVE_TARGET_NUMBER", target),
            ]
            if not v
        ]
        if faltan:
            raise RuntimeError(f"faltan variables en .env: {', '.join(faltan)}")
        return cls(base_url=base, instance=instance, apikey=key, target=target)

    # ------------------------------------------------------------ interno --
    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        resp = httpx.post(
            f"{self.base_url}/{path}/{self.instance}",
            headers={"apikey": self.apikey},
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json() if resp.content else {}
        return data

    def _guard(self) -> None:
        """Kill-switch + tope + pausa: corre antes de CADA envío."""
        if KILL_SWITCH.exists():
            raise LiveRunAborted(f"existe {KILL_SWITCH} — corrida frenada")
        if self.sent >= MAX_MESSAGES_PER_RUN:
            raise BudgetExhausted(
                f"tope de {MAX_MESSAGES_PER_RUN} mensajes alcanzado"
            )
        restante = MIN_PAUSE_SECONDS - (time.monotonic() - self._last_send)
        if restante > 0:
            time.sleep(restante)

    def _sent_ok(self) -> None:
        self.sent += 1
        self._last_send = time.monotonic()

    # ------------------------------------------------------------- envíos --
    def send_text(self, text: str) -> dict[str, Any]:
        self._guard()
        data = self._post("message/sendText", {"number": self.target, "text": text})
        self._sent_ok()
        return data

    def send_voice(self, path: Path) -> dict[str, Any]:
        """Nota de voz (ptt) desde un archivo de audio local (ogg/opus ideal)."""
        self._guard()
        audio_b64 = base64.b64encode(path.read_bytes()).decode()
        data = self._post(
            "message/sendWhatsAppAudio",
            {"number": self.target, "audio": audio_b64},
        )
        self._sent_ok()
        return data

    def send_media(
        self,
        path: Path,
        mediatype: str,  # "image" | "document" | "video"
        caption: str | None = None,
        mimetype: str | None = None,
    ) -> dict[str, Any]:
        self._guard()
        payload: dict[str, Any] = {
            "number": self.target,
            "mediatype": mediatype,
            "mimetype": mimetype
            or mimetypes.guess_type(path.name)[0]
            or "application/octet-stream",
            "media": base64.b64encode(path.read_bytes()).decode(),
            "fileName": path.name,
        }
        if caption:
            payload["caption"] = caption
        data = self._post("message/sendMedia", payload)
        self._sent_ok()
        return data

    def send_sticker(self, path: Path) -> dict[str, Any]:
        """Sticker webp (Evolution v2: message/sendSticker)."""
        self._guard()
        data = self._post(
            "message/sendSticker",
            {"number": self.target, "sticker": base64.b64encode(path.read_bytes()).decode()},
        )
        self._sent_ok()
        return data

    # ------------------------------------------------------------ lectura --
    def connection_state(self) -> str:
        resp = httpx.get(
            f"{self.base_url}/instance/connectionState/{self.instance}",
            headers={"apikey": self.apikey},
            timeout=30,
        )
        resp.raise_for_status()
        state = str(resp.json().get("instance", {}).get("state", "?"))
        return state

    def assert_open(self) -> None:
        state = self.connection_state()
        if state != "open":
            raise RuntimeError(
                f"instancia '{self.instance}' no está conectada (state={state})"
            )

    def find_messages(self, limit: int = 25) -> list[dict[str, Any]]:
        """Mensajes del chat con el número de producción (más recientes primero).

        Ojo (aprendido en vivo): el store de Evolution puede tardar en
        sincronizar o traer orden viejo — para verificación dura usa los LOGS
        del bot en producción; esto es apoyo/mejor-esfuerzo.
        """
        data = self._post(
            "chat/findMessages",
            {
                "where": {"key": {"remoteJid": f"{self.target}@s.whatsapp.net"}},
                "limit": limit,
            },
        )
        records = data.get("messages", data)
        if isinstance(records, dict):
            records = records.get("records", [])
        return list(records) if isinstance(records, list) else []
