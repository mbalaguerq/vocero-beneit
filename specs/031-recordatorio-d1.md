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

`POST /api/bot/reminders/run` és la tanda operativa protegida per
`BOT_API_KEY`; el cron li passa el `templateId` d'una plantilla aprovada i les
variables. La ruta no exposa secrets ni permet enviar sense aquesta
autenticació.
