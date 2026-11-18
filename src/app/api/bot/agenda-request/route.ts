import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { createAgendaServiceRequest } from "@/server/agenda/requests";

export const dynamic = "force-dynamic";

const identifier = z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/);
const bodySchema = z.object({
  sourceEventId: identifier,
  conversationId: identifier,
  clientName: z.string().trim().min(1).max(180),
  phone: z.string().trim().min(6).max(40).regex(/^[+0-9().\-\s]+$/),
  address: z.string().trim().min(1).max(255),
  workType: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(10_000),
});

/**
 * El cerebro llama esta ruta cuando ya reunió todos los datos. Vocero valida
 * el hilo y envía una petición idempotente a la Agenda; el token de Agenda
 * permanece en el servidor y nunca se comparte con el cerebro.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await createAgendaServiceRequest(organizationId, body.data);
    if (!result.ok) return apiError(result.status, result.code, result.message);
    return Response.json({
      requestId: result.requestId,
      status: result.status,
      duplicate: result.duplicate,
    });
  } catch {
    return apiError(500, "agenda_request_internal", "No s’ha pogut processar la petició de l’Agenda");
  }
}
