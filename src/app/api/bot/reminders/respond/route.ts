import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { applyReminderResponse, ReminderError } from "@/server/agenda/reminders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reminderId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  response: z.string().trim().min(1).max(200),
  newStartUtc: z.string().datetime().optional(),
}).refine((body) => body.reminderId || body.conversationId, "reminderId o conversationId es obligatorio");

/** Handler intern per a respostes 1/2/3 del recordatori D-1. */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    return Response.json(await applyReminderResponse({ organizationId, ...body.data }));
  } catch (error) {
    if (error instanceof ReminderError && error.code === "not_ready") {
      return apiError(409, error.code, error.message);
    }
    if (error instanceof Error && error.message === "recordatorio no encontrado") {
      return apiError(404, "not_found", error.message);
    }
    throw error;
  }
}
