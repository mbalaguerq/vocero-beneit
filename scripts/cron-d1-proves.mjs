import { pathToFileURL } from "node:url";

const PROVES_URL = "https://vocero.instalabeneit.es";
const ENDPOINT = `${PROVES_URL}/api/bot/reminders/run`;

/** Una invocación del cron; sin lectura de archivos ni escritura local. */
export async function invokeD1Proves({ appBaseUrl, botApiKey, templateId, fetchImpl = fetch }) {
  if (appBaseUrl !== PROVES_URL) {
    throw new Error("APP_BASE_URL debe ser la URL exacta del CRM de PROVES");
  }
  if (!botApiKey) throw new Error("Falta BOT_API_KEY en el entorno del cron");
  if (!templateId || templateId.length > 255) {
    throw new Error("Indica el templateId de la plantilla D-1 aprobada");
  }

  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": botApiKey },
    body: JSON.stringify({ templateId }),
    redirect: "error",
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`El worker D-1 respondió HTTP ${response.status}`);
  const data = await response.json();
  const result = data?.result;
  if (!["processed", "sent", "cancelled", "failed"].every(
    (key) => Number.isInteger(result?.[key]) && result[key] >= 0
  )) {
    throw new Error("El worker D-1 devolvió una respuesta inesperada");
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  invokeD1Proves({
    appBaseUrl: process.env.APP_BASE_URL,
    botApiKey: process.env.BOT_API_KEY,
    templateId: process.argv[2],
  }).then((result) => {
    console.log(`D-1: procesados=${result.processed} enviados=${result.sent} cancelados=${result.cancelled} fallidos=${result.failed}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Error desconocido en el cron D-1");
    process.exitCode = 1;
  });
}
