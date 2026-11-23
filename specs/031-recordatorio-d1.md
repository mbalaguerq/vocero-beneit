# Recordatori D-1 de cita

## Contracte intern

El recordatori usa una plantilla de WhatsApp aprovada i configurable per
`templateId` i variables. Aquesta versió no envia components interactius perquè
`sendTemplate` no admet botons; el cos inclou el fallback textual numerat:

`1 CONFIRMAR`, `2 CANVIAR DATA`, `3 CANCEL·LAR`.

El worker només selecciona sessions reals (`kind=session`, `status=agendada`,
`is_test=false`) amb contacte i conversa reals. La data de lliurament és sempre
`scheduled_at - 24h`; reprogramar actualitza el recordatori amb `scheduleReminder`.

`POST /api/bot/reminders/respond` rep `reminderId`, `response` i opcionalment
`conversationId` i `newStartUtc`; el client no necessita conèixer el
`reminderId`. Les respostes entrants de WhatsApp passen pel mateix handler.
Les operacions reutilitzen `cancelBooking` i `rescheduleForConversation`; les
respostes desconegudes són no-op idempotent.

La resposta `1 CONFIRMAR` reconeix la cita existent i no canvia el seu estat
`agendada`. Quan entra per WhatsApp, el text queda persistit com a missatge de
la conversa, però l'API `respond` no guarda una confirmació estructurada. Ni
`booking.status` ni `booking_reminder.status` tenen aquest estat. Si cal
consultar o auditar la confirmació de manera independent del missatge, s'ha de
definir i migrar explícitament el model abans d'implementar-la; no es pot
reutilitzar `sent` (lliurament) ni `realizada` (cita completada).

`POST /api/bot/reminders/run` és la tanda operativa protegida per
`BOT_API_KEY`; el cron li passa el `templateId` d'una plantilla aprovada. Per
cada cita, el worker deriva les variables en aquest ordre: nom del contacte,
data local i hora local segons la zona de `calendar_settings`. Només envia les
primeres variables que existeixin a la plantilla, per mantenir compatibilitat
amb plantilles d'una o dues variables. El camp `variables` antic del cron es
tolera per compatibilitat però s'ignora.

Cada invocació reclama com a màxim 20 recordatoris deguts, amb lease atòmic i
`SKIP LOCKED`, i retorna els comptadors agregats `processed`, `sent`,
`cancelled` i `failed`. No inclou secrets ni permet enviar sense
aquesta autenticació.

## Cron a cPanel PROVES (preparació; no activat des del repositori)

El repositori inclou `scripts/cron-d1-proves.mjs`, que només crida
`https://vocero.instalabeneit.es/api/bot/reminders/run`. Exigeix
`APP_BASE_URL=https://vocero.instalabeneit.es` i `BOT_API_KEY` a l'entorn; el
primer argument és l'ID d'una plantilla `recordatorio_cita` aprovada amb les
tres opcions numerades. L'ID de plantilla continua sent configuració del cron,
no és una preferència persistent del CRM. El model inicial de la UI ja inclou
les opcions, però una plantilla existent s'ha de revisar i aprovar a Meta.

Després de confirmar l'URL, el nom de la base PostgreSQL del CRM i l'usuari
cPanel `ra406321`, preparar un fitxer d'entorn privat fora del webroot amb les
variables existents i permisos només per a l'usuari del cron. Confirmar al
panell la ruta real de Node i l'ID de plantilla; no posar la clau a la línia
de comandes. Exemple de comanda cPanel, cada cinc minuts (substituir les rutes
i l'ID pels valors verificats):

```sh
cd /home/ra406321/vocero.instalabeneit.es && /ruta/node --env-file=/ruta/privada/entorn-cron scripts/cron-d1-proves.mjs ID_PLANTILLA
```

No activar el cron fins verificar que l'aplicació de PROVES té la migració
`0025` aplicada, la plantilla aprovada i el mateix `BOT_API_KEY` al runtime.
Cada execució informa només els quatre comptadors; una resposta HTTP no 2xx
produeix sortida amb codi 1. El script no segueix redireccions i no mostra la
clau. La petició pot enviar missatges reals des de PROVES: provar-la només
amb el destí i les dades de prova confirmats.
