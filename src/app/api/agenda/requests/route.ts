import { and, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { createAgendaServiceRequest } from "@/server/agenda/requests";

export const dynamic = "force-dynamic";

function textValue(ficha: Record<string, unknown> | null, keys: string[]) {
  if (!ficha) return "";
  const normalize = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const wanted = new Set(keys.map(normalize));
  for (const [key, rawValue] of Object.entries(ficha)) {
    if (!wanted.has(normalize(key))) continue;
    if (typeof rawValue === "string" && rawValue.trim()) return rawValue.trim();
  }
  return "";
}

export const POST = withAuth(async (session, req: Request) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(422, "invalid_body", "El body ha de ser JSON vàlid.");
  }
  const leadId = typeof body === "object" && body !== null && "leadId" in body
    ? String((body as { leadId?: unknown }).leadId ?? "").trim()
    : "";
  if (!leadId) return apiError(422, "invalid_body", "Falta la petició.");

  const db = getDb();
  const rows = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversation: schema.conversation,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false),
        eq(schema.conversation.channel, "whatsapp")
      )
    )
    .where(and(scoped(schema.lead.organizationId, session.organizationId), eq(schema.lead.id, leadId)))
    .limit(1);
  const row = rows[0];
  if (!row) return apiError(404, "not_found", "No s'ha trobat una conversa real per a aquesta petició.");
  if (!row.contact.phone) return apiError(422, "missing_phone", "Falta el telèfon del contacte.");

  const ficha = (row.contact.ficha ?? {}) as Record<string, unknown>;
  const address = textValue(ficha, ["adreça", "direcció", "address", "direccion"]);
  const workType = textValue(ficha, ["tipus de feina", "tipo de trabajo", "workType", "service", "resultado", "feina", "servei"]);
  const description = textValue(ficha, ["descripció", "descripción", "description", "detalls", "detalles"]);
  if (!address || !workType || !description) {
    return apiError(422, "missing_request_data", "Cal completar adreça, tipus de feina i descripció abans d'enviar-la a l'Agenda.");
  }

  const result = await createAgendaServiceRequest(session.organizationId, {
    sourceEventId: `conversation:${row.conversation.id}`,
    conversationId: row.conversation.id,
    clientName: row.contact.name,
    phone: row.contact.phone,
    address,
    workType,
    description,
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return Response.json(result);
});
