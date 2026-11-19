# Context permanent del projecte Vocero Beneït

Actualitzat el 2026-11-19. Aquest document conté només noms de variables, rutes i dades no secretes.

## 1. Arquitectura i ubicació

| Component | Plataforma | Repositori/projecte | URL | Base de dades | Accés | Estat |
|---|---|---|---|---|---|---|
| Agent Nea | Render, servei `vocero-nea-proves` | `mbalaguerq/vocero-beneit`, `main` | `https://proves.instalabeneit.es` per a l’agenda; `/health` al servei Render | PostgreSQL de l’agent; el codi usa `bot_conversation`, `bot_message`, `offered_slots`, cues i estat de missatges processats | Render i repositori | **VERIFICAT**: `app/`, `app/db.py`, `app/config.py`; desplegament Live i proves informades |
| CRM de proves | Supabase “Vocero Beneït Proves” | Projecte Supabase `lhqzqvjwzvkaleiksjob`; projecte sense repositori GitHub connectat | `https://lhqzqvjwzvkaleiksjob.supabase.co` | Esquema exacte de conversa, memòria, cites i embut | Supabase Dashboard | **VERIFICAT**: nom, URL, estat Healthy i “No repository connected” al Dashboard. Taules exactes del CRM: **NO VERIFICAT** |
| Agenda PHP de proves | Servidor de proves | Repositori local App Beneit Agenda | `https://proves.instalabeneit.es` | `ra406321_agenda_proves` | cPanel/phpMyAdmin i aplicació PHP | **VERIFICAT**: taula `whatsapp_service_requests` i endpoint `POST /api/whatsapp/requests` segons el codi i les comprovacions E2E |
| Producció | Servidor de producció | `kevinrivm/vocero-crm` i agenda de producció | **NO DOCUMENTAR URL OPERATIVA** | **NO VERIFICAT** en aquest projecte | Prohibit tocar-ho | **VERIFICAT**: queda fora de l’abast |

El CRM de proves no és dins d’aquest repositori. No s’ha identificat un repositori de codi accessible per al CRM; no s’ha d’editar `vocero-beneit` per canviar la UI del CRM.

## 2. Flux E2E

WhatsApp → CRM → `POST /vocero/dispatch` signat → `book_session` o `manual_proposal` → `app/agenda_bridge.py` → `POST /api/whatsapp/requests` → `whatsapp_service_requests` i feina sense assignar → notificacions, historial, auditoria i cua d’iCloud a l’agenda.

**VERIFICAT al codi de Nea:** el CRM és qui rep WhatsApp i despacha a Nea; Nea respon via l’API del CRM i no envia directament a Meta. El pont d’agenda viu a `app/agenda_bridge.py`/`app/tools.py`.

## 3. Accessos i variables

Només es documenten noms:

| Variable o accés | Ús | Estat/font |
|---|---|---|
| `AGENDA_BASE_URL` | URL base de l’agenda de proves | **VERIFICAT** al codi i configuració de desplegament coneguda |
| `PHASE6_API_TOKEN` | Autenticació del pont cap a l’agenda | **VERIFICAT** al codi i configuració de proves coneguda; el valor mai es mostra |
| `CRM_BASE_URL` | API del CRM | **VERIFICAT** a `app/config.py` |
| `CRM_BOT_API_KEY` | Autenticació CRM/agent | **VERIFICAT** a `app/config.py` i `app/dispatch.py` |
| `DATABASE_URL` | Connexió PostgreSQL | **NO VERIFICAT** com a nom efectiu del desplegament; revisar `Settings`/Render |
| `DATABASE_SCHEMA` | Esquema PostgreSQL opcional | **VERIFICAT** a `app/db.py`/configuració del projecte |
| `ALLOWED_WA_IDS`, `TESTER_WA_IDS` | Allowlist i reinici de proves | **VERIFICAT** a `app/config.py` |
| `VOCERO_MODE`, `CRM_BRAIN_SECRET`, `CRM_ORGANIZATION` | Mode cloud i multi-organització | **VERIFICAT** a `app/config.py` |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_TRANSCRIBE_MODEL`, `LLM_REASONING_EFFORT`, `LLM_PROVIDER_SORT`, `LLM_TIMEOUT_SECONDS` | Model i transcripció | **VERIFICAT** a `app/config.py` |
| Variables de Supabase/CRM | Connexió del projecte “Vocero Beneït Proves” | **NO VERIFICAT**: cal consultar Render/Supabase sense exposar valors |

## 4. Procediments

### Desplegament

El desplegament automàtic de `main` a Render està documentat per l’estat observat del servei `vocero-nea-proves`; el mètode exacte del servei (auto-deploy, manual o un altre) és **NO VERIFICAT**. Després d’un desplegament, comprovar `/health` i els logs, sense imprimir variables.

### Proves

Comanda local: `pytest`. Resultat de referència verificat: `566 collected`, `536 passed`, `30 skipped`. Els gates de projecte indiquen que typecheck i pytest verds són el mínim de fet.

### Reinici de proves

Nea té `POST /api/bot/reset` com a operació del client CRM, però `app/db.py` també exposa el reinici local de conversa que elimina missatges i `offered_slots` i restableix l’estat de conversa. Els noms i les operacions exactes estan verificats al codi local.

El reinici complet del CRM (cita, embut, memòria del CRM i conversa) **NO ÉS IMPLEMENTABLE DES D’AQUEST REPOSITORI** perquè les taules i l’endpoint administratiu del CRM no hi són. No executar SQL contra Supabase inventant taules o camps. Per a PostgreSQL local, usar només els mètodes existents de `app/db.py` i identificar la conversa per `organization_id`, identitat i `crm_conversation_id`.

### E2E

1. Usar només el número de proves i una conversa identificada.
2. Confirmar que no hi ha una cita activa al CRM.
3. Enviar missatge nou, completar dades, proposar i acceptar visita.
4. Comprovar logs de Render: `/vocero/dispatch` i crida al pont d’agenda sense errors.
5. Comprovar a `ra406321_agenda_proves`: nova fila `whatsapp_service_requests`, `work_type` no buit, `job_id` i feina amb data nul·la.
6. Comprovar notificacions, `job_history`, `audit_logs`, `icloud_sync_queue` i idempotència.

## 5. Regles de comportament

- Llegir aquest fitxer abans de cada tasca. Si contradiu la petició o la font real, avisar i no improvisar.
- Descobrir els fets a la configuració real i al codi. Màxim tres intents per hipòtesi, cadascun amb evidència.
- Treballar només a PROVES. Cap operació destructiva massiva; esborrats només per ID, amb còpia prèvia i transacció quan el sistema ho permeti.
- Mai imprimir secrets ni valors d’entorn.
- No inventar imports, endpoints, taules ni camps; mantenir signatures i canvis mínims.
- No donar res per bo sense evidència en SQL i logs.
- Actualitzar aquest fitxer quan es descobreixi o corregeixi un fet.

## 6. NO VERIFICAT / pendent de confirmar

- Repositori exacte del CRM de proves i el seu mètode de desplegament.
- Esquema i noms de taules del CRM a Supabase per a converses, memòria, cites i embut.
- Variables exactes configurades actualment a Render, només noms i mai valors.
- Endpoint administratiu oficial per cancel·lar una cita del CRM sense handoff.
- Procediment reversible oficial per reiniciar una conversa del CRM.
- Si Supabase és només el CRM o també conté dades addicionals del servei.

