import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type AgendaServiceRequestInput = {
  sourceEventId: string;
  conversationId: string;
  clientName: string;
  phone: string;
  address: string;
  workType: string;
  description: string;
};

export type AgendaServiceRequestResult =
  | { ok: true; requestId: string; status: string; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string };

/** Envía a la Agenda Beneit una petición completa asociada a un hilo real. */
export async function createAgendaServiceRequest(
  organizationId: string,
  input: AgendaServiceRequestInput
): Promise<AgendaServiceRequestResult> {
  const baseValue = process.env.AGENDA_REQUESTS_BASE_URL;
  const token = process.env.AGENDA_REQUESTS_TOKEN;
  if (!baseValue || !token || token.length < 32) {
    return {
      ok: false,
      status: 503,
      code: "agenda_not_configured",
      message: "La integració amb l’Agenda no està configurada.",
    };
  }

  let base: URL;
  try {
    base = new URL(baseValue);
  } catch {
    return {
      ok: false,
      status: 503,
      code: "agenda_not_configured",
      message: "La URL de l’Agenda no és vàlida.",
    };
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && localHosts.has(base.hostname))) ||
    base.username || base.password || base.search || base.hash
  ) {
    return {
      ok: false,
      status: 503,
      code: "agenda_not_configured",
      message: "La URL externa de l’Agenda ha d’utilitzar HTTPS.",
    };
  }

  const db = getDb();
  const conversations = await db
    .select({
      contactId: schema.contact.id,
      contactPhone: schema.contact.phone,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, input.conversationId),
        eq(schema.conversation.channel, "whatsapp"),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);

  const conversation = conversations[0];
  if (!conversation) {
    return {
      ok: false,
      status: 404,
      code: "whatsapp_conversation_not_found",
      message: "No s’ha trobat una conversa real de WhatsApp per a aquesta petició.",
    };
  }

  // Accept both the agenda origin (https://.../) and an already-scoped API
  // base (https://.../api). cPanel deployments have used both forms.
  const basePath = base.pathname.replace(/\/+$/, "");
  const endpoint = basePath.endsWith("/api")
    ? "whatsapp/requests"
    : "api/whatsapp/requests";
  const url = new URL(endpoint, base.href.endsWith("/") ? base : `${base.href}/`);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...input,
        contactId: conversation.contactId,
        phone: conversation.contactPhone ?? input.phone,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const payload = (await upstream.json().catch(() => null)) as
      | { requestId?: unknown; status?: unknown; duplicate?: unknown }
      | null;
    if (!upstream.ok || typeof payload?.requestId !== "string") {
      const status = upstream.status === 409 ? 409 : upstream.status === 422 ? 422 : 502;
      return {
        ok: false,
        status,
        code: "agenda_request_failed",
        message: `L’Agenda no ha pogut registrar la petició (HTTP ${upstream.status}).`,
      };
    }
    return {
      ok: true,
      requestId: payload.requestId,
      status: typeof payload.status === "string" ? payload.status : "pending",
      duplicate: payload.duplicate === true,
    };
  } catch {
    return {
      ok: false,
      status: 502,
      code: "agenda_unreachable",
      message: "No s’ha pogut contactar amb l’Agenda. La conversa es conserva a Vocero.",
    };
  }
}
