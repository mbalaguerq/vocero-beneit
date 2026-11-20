import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { runD1ReminderWorker } from "@/server/agenda/reminders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  templateId: z.string().min(1).max(255),
  variables: z.array(z.string().max(500)).max(10).default([]),
});

/** Tanda invocable por cron: solo acepta la llave interna del cerebro. */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  return Response.json({
    organizationId,
    result: await runD1ReminderWorker({
      template: { templateId: body.data.templateId, variables: body.data.variables ?? [] },
    }),
  });
}
