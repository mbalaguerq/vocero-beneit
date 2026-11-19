# Context permanent del projecte Vocero Beneït

Actualitzat el 2026-11-19. Aquest document conté només noms de variables, rutes i dades no secretes.

## 1. Arquitectura i ubicació

| Component | Plataforma | Repositori/projecte | URL | Base de dades | Accés | Estat |
|---|---|---|---|---|---|---|
| Agent Nea | Render, servei `vocero-nea-proves` | `mbalaguerq/vocero-beneit`, `main` | `https://proves.instalabeneit.es` per a l’agenda; `/health` al servei Render | PostgreSQL de l’agent; el codi usa `bot_conversation`, `bot_message`, `offered_slots`, cues i estat de missatges processats | Render i repositori | **VERIFICAT**: `app/`, `app/db.py`, `app/config.py`; desplegament Live i proves informades |
| CRM de proves | cPanel, URL `vocero.instalabeneit.es` | **Font indicada per l’usuari:** el codi complet és local i és la font de veritat; la còpia del domini només serveix per disposar d’una URL de proves | `https://vocero.instalabeneit.es` | **NO VERIFICAT**: encara no identificada | cPanel/File Manager i codi local | **VERIFICAT per l’usuari**: comparteix servidor amb les agendes; **VERIFICAT al cPanel**: `/home/ra406321/vocero.instalabeneit.es` apareix buit |
| Agenda PHP de proves | Servidor de proves | Repositori local App Beneit Agenda | `https://proves.instalabeneit.es` | `ra406321_agenda_proves` | cPanel/phpMyAdmin i aplicació PHP | **VERIFICAT**: taula `whatsapp_service_requests` i endpoint `POST /api/whatsapp/requests` segons el codi i les comprovacions E2E |
| Producció | Servidor de producció | `kevinrivm/vocero-crm` i agenda de producció | **NO DOCUMENTAR URL OPERATIVA** | **NO VERIFICAT** en aquest projecte | Prohibit tocar-ho | **VERIFICAT**: queda fora de l’abast |

El projecte Supabase “Vocero Beneït Proves” és buit i **NO S’USA**, segons l’usuari i les comprovacions del Dashboard: no hi ha taules públiques, funcions, Edge Functions ni buckets visibles. Segons l’usuari, el codi complet del CRM existeix localment i és la font de veritat; la ruta local exacta encara no s’ha pogut verificar. El codi desplegat del CRM sí que s’ha localitzat al servidor, a `/home/ra406321/vocero.instalabeneit.es`, incloent `src/app/api/`, `src/server/` i `drizzle/`. El File Manager no mostrava els fitxers ocults; el terminal de cPanel els ha confirmat.

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
| `PORT` | Port del servei Render | **VERIFICAT** a Render |
| Variables de Render del servei | Render mostra exactament `AGENDA_BASE_URL`, `CRM_BASE_URL`, `CRM_BOT_API_KEY`, `DATABASE_SCHEMA`, `DATABASE_URL`, `PHASE6_API_TOKEN`, `PORT` | **VERIFICAT** al servei Render `vocero-nea-proves`; els valors no es documenten |
| `DATABASE_URL` | Connexió Drizzle/PostgreSQL del CRM | **VERIFICAT al procés i a la configuració del webroot**: el procés Node exposa el nom de variable; el `.env` del webroot identifica l’objectiu com a PostgreSQL `vocero`, usuari `postgres`, host `localhost`, port `5432`; el valor complet no es documenta |
| `AGENDA_REQUESTS_BASE_URL`, `AGENDA_REQUESTS_TOKEN`, `BOT_API_KEY`, `IG_GRAPH_BASE_URL`, `IG_GRAPH_API_VERSION`, `META_GRAPH_API_VERSION`, `META_GRAPH_BASE_URL`, `OPENROUTER_API_TOKEN`, `ZERNIO_BASE_URL` | Configuració del CRM desplegat | **VERIFICAT com a noms** per la lectura del codi/configuració de `vocero.instalabeneit.es`; els valors no es documenten |
| Variables internes del projecte Supabase | Configuració del CRM | **NO VERIFICAT**: el projecte Supabase consultat és buit i no s’utilitza segons l’usuari |

## 4. Procediments

### Desplegament

Render verifica el servei `vocero-nea-proves` connectat a `mbalaguerq/vocero-beneit`, branca `main`, runtime Docker, URL pública `https://vocero-nea-proves.onrender.com`, amb desplegament automàtic. El CRM de proves allotjat a `vocero.instalabeneit.es` és una còpia servida per cPanel segons l’usuari; el webroot/codi desplegat s’ha verificat a `/home/ra406321/vocero.instalabeneit.es`. La pujada concreta (File Manager, FTP o un altre mecanisme) continua **NO VERIFICADA**.

### Proves

Comanda local: `pytest`. Resultat de referència verificat: `566 collected`, `536 passed`, `30 skipped`. Els gates de projecte indiquen que typecheck i pytest verds són el mínim de fet.

### Reinici de proves

Nea té `POST /api/bot/reset` com a operació del client CRM, però no s’ha trobat aquesta ruta al CRM desplegat: l’inventari de `src/app/api/**/route.ts` no conté `bot/reset`. El CRM sí que té una rutina interna a `src/server/inbox/eliminar.ts` que retira una conversa i tracta els fitxers adjunts; el seu endpoint públic i el seu abast complet no estan confirmats. `app/db.py` del servei Nea també exposa el reinici local de conversa que elimina missatges i `offered_slots` i restableix l’estat de conversa.

El reinici complet del CRM (cita, embut, memòria del CRM i conversa) **NO ÉS IMPLEMENTABLE DES D’AQUEST REPOSITORI** perquè el projecte Supabase consultat no mostra taules públiques del CRM i no s’ha identificat el backend/BD real. No executar SQL contra Supabase inventant taules o camps. Per a PostgreSQL local, usar només els mètodes existents de `app/db.py` i identificar la conversa per `organization_id`, identitat i `crm_conversation_id`.

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

- Ruta local exacta del repositori/codi complet del CRM.
- Ruta local exacta del repositori/codi complet del CRM; la còpia desplegada sí és a `/home/ra406321/vocero.instalabeneit.es`.
- Confirmació de connexió de lectura a la BD: el servidor no té `psql` CLI disponible; la configuració apunta a PostgreSQL local `vocero`, però no s’ha executat cap consulta SQL.
- Endpoint administratiu oficial per cancel·lar una cita del CRM sense handoff.
- Procediment reversible oficial per reiniciar una conversa del CRM.
- Procediment de desplegament efectiu del CRM a cPanel.
- Si el projecte Supabase és només un projecte buit sense ús (la dada d’ús/no ús és **VERIFICADA per l’usuari**, però la relació exacta amb el CRM no és observable al Dashboard).

## 7. Fets aportats per l’usuari

- **VERIFICAT per l’usuari:** `vocero.instalabeneit.es` és el CRM de proves, allotjat a cPanel al mateix servidor que `proves.instalabeneit.es` i `agenda.instalabeneit.es`.
- **VERIFICAT per l’usuari:** el codi complet del CRM és local, és la font de veritat i la còpia del domini només existeix per oferir una URL de proves.
- **VERIFICAT per l’usuari:** el projecte Supabase “Vocero Beneït Proves” és buit i no s’utilitza.

## 8. Descoberta del CRM al servidor

- **VERIFICAT al servidor/cPanel:** el codi desplegat és a `/home/ra406321/vocero.instalabeneit.es`; el directori conté `src/app/api`, `src/server`, `drizzle`, `.next`, scripts i proves.
- **VERIFICAT al servidor/codi:** el CRM usa Next.js i Drizzle amb dialecte PostgreSQL; les migracions visibles de `drizzle/` defineixen, entre altres, `contact`, `conversation`, `message`, `lead`, `lead_stage_event`, `pipeline_stage`, `offered_slots`/equivalent segons el codi de Nea, `organization`, `member`, `user`, `session`, `media_asset` i taules de credencials.
- **VERIFICAT al servidor/configuració:** el `.env` del webroot conté `DATABASE_URL` apuntant a PostgreSQL local amb base `vocero`, usuari `postgres`, host `localhost` i port `5432`; no es documenta el valor complet.
- **VERIFICAT al servidor/codi:** no s’ha trobat una ruta `src/app/api/bot/reset/route.ts` ni cap ruta equivalent `bot/reset` al llistat d’API.
- **VERIFICAT al servidor/codi:** `src/server/inbox/eliminar.ts` conté la rutina interna de retirada d’una conversa i tractament d’adjunts; no s’ha executat.

