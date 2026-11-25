import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { countVariables } from "@/lib/templates";
import { scoped } from "@/lib/db/tenant";
import { cancelBooking, rescheduleForConversation } from "@/server/agenda/service";
import { getSettings } from "@/server/agenda/settings";
import { timeInTz } from "@/lib/time/slots";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import { isD1TestDataEnabled } from "@/lib/env";

export const D1_MAX_ATTEMPTS = 3;
export const D1_LEASE_MS = Number(process.env.D1_LEASE_MINUTES ?? 10) * 60_000;
export const D1_BATCH_SIZE = 20;
export const D1_REMINDER_CONTRACT = {
  type: "d1",
  interactive: false,
  options: [
    { number: "1", action: "confirm", label: "CONFIRMAR" },
    { number: "2", action: "reschedule", label: "CANVIAR DATA" },
    { number: "3", action: "cancel", label: "CANCEL·LAR" },
  ],
  fallback: "Respon 1 per CONFIRMAR, 2 per CANVIAR DATA o 3 per CANCEL·LAR.",
} as const;

export function expiredLeaseStatus(attempts: number): "pending" | "failed" {
  return attempts >= D1_MAX_ATTEMPTS ? "failed" : "pending";
}

export type ReminderAction = "confirm" | "reschedule" | "cancel" | "handoff";
export type D1ReminderTemplateConfig = { templateId: string; variables: string[] };
export type D1ReminderWorkerResult = {
  processed: number;
  sent: number;
  cancelled: number;
  failed: number;
};

export class ReminderError extends Error {
  constructor(public readonly code: "not_ready" | "invalid_template", message: string) {
    super(message);
    this.name = "ReminderError";
  }
}

export function reminderDueAt(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - 24 * 60 * 60_000);
}

export function reminderText(name: string, scheduledAt: Date, timezone: string): string {
  const label = new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(scheduledAt);
  return `Hola${name ? ` ${name}` : ""}, te recordamos tu cita del ${label}.\n\n${D1_REMINDER_CONTRACT.fallback}`;
}

export function reminderTemplateVariables(
  name: string,
  scheduledAt: Date,
  timezone: string,
  variableCount: number
): string[] {
  const date = new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(scheduledAt);
  return [name, date, timeInTz(scheduledAt.toISOString(), timezone)].slice(0, variableCount);
}

export function parseReminderAction(input: string): ReminderAction | null {
  const value = input.trim().toLocaleLowerCase("es-ES").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (["1", "confirmar", "confirmo", "sí", "si"].includes(value)) return "confirm";
  if (["2", "cambiar", "cambiar fecha", "canviar data"].includes(value)) return "reschedule";
  if (["3", "cancelar"].includes(value) || /^cancel\W?lar(?: cita)?$/u.test(value)) return "cancel";
  if (/\b(humano|humana|human|persona|persones|agent|agente)\b/.test(value)) return "handoff";
  return null;
}

export function hasD1Fallback(body: string): boolean {
  const normalized = body.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleUpperCase("es-ES");
  return D1_REMINDER_CONTRACT.options.every(({ number, label }) =>
    normalized.includes(number) && normalized.includes(label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleUpperCase("es-ES"))
  );
}

export async function scheduleReminder(input: {
  organizationId: string;
  bookingId: string;
  scheduledAt: Date;
}): Promise<void> {
  const dueAt = reminderDueAt(input.scheduledAt);
  await getDb().insert(schema.bookingReminder).values({
    id: newId("reminder"), organizationId: input.organizationId,
    bookingId: input.bookingId, type: "d1", dueAt,
  }).onConflictDoUpdate({
    target: [schema.bookingReminder.organizationId, schema.bookingReminder.bookingId, schema.bookingReminder.type],
    set: {
      dueAt, status: "pending", attempts: 0, leaseUntil: null,
      sentAt: null, cancelledAt: null, lastError: null, confirmations: [],
      claimedAt: null, workerId: null, providerMessageId: null, updatedAt: new Date(),
    },
  });
}

export async function cancelBookingReminder(organizationId: string, bookingId: string): Promise<void> {
  const now = new Date();
  await getDb().update(schema.bookingReminder).set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(scoped(schema.bookingReminder.organizationId, organizationId, and(
      eq(schema.bookingReminder.bookingId, bookingId),
      inArray(schema.bookingReminder.status, ["pending", "sending", "sent", "failed"])
    )));
}

/** Claim atòmic amb FOR UPDATE SKIP LOCKED: dos workers no poden enviar la mateixa fila. */
export async function claimD1Reminder(
  organizationId: string,
  now = new Date(),
  attemptedIds: string[] = [],
  workerId = "d1-worker"
): Promise<typeof schema.bookingReminder.$inferSelect | null> {
  const leaseUntil = new Date(now.getTime() + D1_LEASE_MS);
  const excludeAttempted = attemptedIds.length > 0
    ? sql`AND id NOT IN (${sql.join(attemptedIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const result = await getDb().execute(sql`
    WITH candidate AS (
      SELECT id FROM booking_reminder
      WHERE organization_id = ${organizationId} AND type = 'd1'
        AND status = 'pending'
        AND due_at <= ${now.toISOString()} AND attempts < ${D1_MAX_ATTEMPTS}
        ${excludeAttempted}
      ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE booking_reminder AS reminder
    SET status = 'sending', attempts = reminder.attempts + 1,
        lease_until = ${leaseUntil.toISOString()}, claimed_at = ${now.toISOString()},
        worker_id = ${workerId}, updated_at = ${now.toISOString()}
    FROM candidate WHERE reminder.id = candidate.id RETURNING reminder.*
  `);
  const row = (result as unknown as Record<string, unknown>[])[0];
  return (row as typeof schema.bookingReminder.$inferSelect | undefined) ?? null;
}

export async function runD1ReminderWorker(input: {
  organizationId: string;
  template: D1ReminderTemplateConfig;
  now?: Date;
}): Promise<D1ReminderWorkerResult> {
  const now = input.now ?? new Date();
  const templates = await getDb().select({ body: schema.template.body, status: schema.template.status })
    .from(schema.template)
    .where(scoped(schema.template.organizationId, input.organizationId, eq(schema.template.id, input.template.templateId)))
    .limit(1);
  const template = templates[0];
  if (!template || template.status !== "approved" || !hasD1Fallback(template.body)) {
    throw new ReminderError("invalid_template", "La plantilla D-1 debe estar aprobada e incluir las opciones 1 CONFIRMAR, 2 CANVIAR DATA y 3 CANCEL·LAR");
  }
  const result: D1ReminderWorkerResult = { processed: 0, sent: 0, cancelled: 0, failed: 0 };
  const attemptedIds: string[] = [];
  const workerId = crypto.randomUUID();
  for (let i = 0; i < D1_BATCH_SIZE; i++) {
    if (i === 0) {
      await getDb().update(schema.bookingReminder).set({
        status: "sent", sentAt: now, leaseUntil: null, claimedAt: null, workerId: null, updatedAt: now,
      }).where(scoped(schema.bookingReminder.organizationId, input.organizationId, and(
        eq(schema.bookingReminder.status, "sending"),
        sql`${schema.bookingReminder.leaseUntil} <= CURRENT_TIMESTAMP`,
        sql`${schema.bookingReminder.providerMessageId} is not null`
      )));
    }
    const expired = i === 0 ? await getDb().execute(sql`
      UPDATE booking_reminder AS reminder
      SET status = CASE WHEN reminder.attempts >= ${D1_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
          lease_until = NULL, claimed_at = NULL, worker_id = NULL,
          last_error = CASE WHEN reminder.attempts >= ${D1_MAX_ATTEMPTS}
            THEN 'Lease caducat després del màxim d’intents; resultat d’enviament no confirmat'
            ELSE reminder.last_error END,
          updated_at = ${now.toISOString()}
      WHERE reminder.organization_id = ${input.organizationId}
        AND reminder.status = 'sending'
        AND reminder.lease_until <= CURRENT_TIMESTAMP
        AND reminder.provider_message_id IS NULL
      RETURNING reminder.id, reminder.status
    `) : [];
    result.failed += (expired as unknown as { status: string }[]).filter((row) => row.status === "failed").length;
    const reminder = await claimD1Reminder(input.organizationId, now, attemptedIds, workerId);
    if (!reminder) {
      break;
    }
    attemptedIds.push(reminder.id);
    result.processed++;
    const rows = await getDb().select({ booking: schema.booking, contact: schema.contact, conversation: schema.conversation })
      .from(schema.booking)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
      .innerJoin(schema.conversation, eq(schema.conversation.id, schema.booking.conversationId))
      .where(scoped(schema.booking.organizationId, reminder.organizationId, and(
        eq(schema.booking.id, reminder.bookingId), eq(schema.booking.kind, "session"),
        eq(schema.booking.status, "agendada"),
        isD1TestDataEnabled()
          ? eq(schema.conversation.channel, "whatsapp")
          : and(
              eq(schema.booking.isTest, false),
              eq(schema.conversation.isTest, false),
              eq(schema.conversation.channel, "whatsapp")
            )
      ))).limit(1);
    const target = rows[0];
    if (!target) {
      await cancelBookingReminder(reminder.organizationId, reminder.bookingId);
      result.cancelled++;
      continue;
    }
    try {
      if (reminder.providerMessageId) {
        await getDb().update(schema.bookingReminder).set({ status: "sent", sentAt: now, leaseUntil: null, updatedAt: now })
          .where(scoped(schema.bookingReminder.organizationId, reminder.organizationId, eq(schema.bookingReminder.id, reminder.id)));
        result.sent++;
        continue;
      }
      // The claimed row is the authoritative tenant for the rest of this
      // attempt. Keep settings and delivery on the same scoped organization
      // as the reminder, even if the cron's instance-org lookup is stale.
      const settings = await getSettings(reminder.organizationId);
      const delivery = await sendTemplate({
        organizationId: reminder.organizationId,
        conversationId: target.conversation.id,
        templateId: input.template.templateId,
        variables: reminderTemplateVariables(target.contact.name, target.booking.scheduledAt, settings.timezone, countVariables(template.body)),
      });
      await getDb().update(schema.bookingReminder).set({ providerMessageId: delivery.providerMessageId })
        .where(scoped(schema.bookingReminder.organizationId, reminder.organizationId, and(
          eq(schema.bookingReminder.id, reminder.id),
          eq(schema.bookingReminder.status, "sending"),
          eq(schema.bookingReminder.attempts, reminder.attempts),
          eq(schema.bookingReminder.workerId, workerId),
        )));
    } catch (error) {
      // TemplateError ocurre antes de POST /messages. El resto puede ser posterior
      // a la aceptación por Meta o a la persistencia local: no es reintentable.
      const retryable = error instanceof TemplateError && reminder.attempts < D1_MAX_ATTEMPTS;
      await getDb().update(schema.bookingReminder).set({
        status: retryable ? "pending" : "failed", leaseUntil: null, claimedAt: null, workerId: null,
        lastError: retryable && error instanceof Error
          ? error.message.slice(0, 500)
          : "Resultado del envío incierto; revisar Meta y CRM antes de reintentar",
        updatedAt: now,
      }).where(scoped(schema.bookingReminder.organizationId, reminder.organizationId, eq(schema.bookingReminder.id, reminder.id)));
      result.failed++;
      continue;
    }
    // Un fallo al marcar `sent` deja el lease: otro cron lo cerrará como incierto.
    try {
      const marked = await getDb().update(schema.bookingReminder).set({
        status: "sent", sentAt: now, leaseUntil: null, updatedAt: now,
      }).where(scoped(schema.bookingReminder.organizationId, reminder.organizationId, and(
        eq(schema.bookingReminder.id, reminder.id), eq(schema.bookingReminder.status, "sending"),
        eq(schema.bookingReminder.attempts, reminder.attempts), eq(schema.bookingReminder.dueAt, reminder.dueAt)
      ))).returning({ id: schema.bookingReminder.id });
      if (marked.length === 0) {
        result.failed++;
        continue;
      }
      result.sent++;
    } catch {
      // El lease queda intacto: la siguiente tanda lo cerrará como resultado incierto.
      result.failed++;
    }
  }
  return result;
}

export async function applyReminderResponse(input: {
  organizationId: string;
  reminderId?: string;
  conversationId?: string;
  response: string;
  newStartUtc?: string;
}): Promise<{ action: ReminderAction | "unknown"; idempotent: boolean; pending?: boolean }> {
  const action = parseReminderAction(input.response);
  if (!action) return { action: "unknown", idempotent: true };
  const rows = await getDb().select({ reminder: schema.bookingReminder, booking: schema.booking })
    .from(schema.bookingReminder).innerJoin(schema.booking, eq(schema.booking.id, schema.bookingReminder.bookingId))
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.booking.conversationId))
    .where(scoped(schema.bookingReminder.organizationId, input.organizationId, and(
      input.reminderId
        ? eq(schema.bookingReminder.id, input.reminderId)
        : eq(schema.conversation.id, input.conversationId ?? ""),
    ))).orderBy(sql`${schema.bookingReminder.createdAt} desc`).limit(1);
  const row = rows[0];
  if (!row) throw new Error("recordatorio no encontrado");
  if (!["sent", "cancelled"].includes(row.reminder.status)) {
    throw new ReminderError("not_ready", "El recordatorio todavía no se ha enviado");
  }
  if (action === "confirm") {
    if (row.reminder.status !== "sent" || row.booking.status !== "agendada") {
      throw new ReminderError("not_ready", "No hay una cita activa con recordatorio enviado que confirmar");
    }
    const dueAt = row.reminder.dueAt.toISOString();
    const now = new Date();
    const confirmation = JSON.stringify([{ dueAt, confirmedAt: now.toISOString() }]);
    const alreadyConfirmed = JSON.stringify([{ dueAt }]);
    const inserted = await getDb().update(schema.bookingReminder).set({
      confirmations: sql`${schema.bookingReminder.confirmations} || ${confirmation}::jsonb`,
      updatedAt: now,
    }).where(scoped(schema.bookingReminder.organizationId, input.organizationId, and(
      eq(schema.bookingReminder.id, row.reminder.id), eq(schema.bookingReminder.status, "sent"),
      eq(schema.bookingReminder.dueAt, row.reminder.dueAt),
      sql`NOT (${schema.bookingReminder.confirmations} @> ${alreadyConfirmed}::jsonb)`
    ))).returning({ id: schema.bookingReminder.id });
    return { action, idempotent: inserted.length === 0 };
  }
  if (action === "cancel") {
    const idempotent = row.booking.status === "cancelada";
    if (!idempotent) {
      await cancelBooking({ organizationId: input.organizationId, bookingId: row.booking.id });
      await cancelBookingReminder(input.organizationId, row.booking.id);
    }
    return { action, idempotent };
  }
  if (action === "reschedule" && !input.newStartUtc) {
    return { action, idempotent: false, pending: true };
  }
  if (action === "reschedule" && input.newStartUtc && row.booking.conversationId) {
    await rescheduleForConversation({ organizationId: input.organizationId, conversationId: row.booking.conversationId, startUtc: input.newStartUtc });
  }
  if (action === "handoff" && row.booking.conversationId) {
    const now = new Date();
    await getDb().update(schema.conversation).set({
      aiEnabled: false, handoffAt: now, handoffReason: "cliente", updatedAt: now,
    }).where(and(
      eq(schema.conversation.organizationId, input.organizationId),
      eq(schema.conversation.id, row.booking.conversationId),
      sql`${schema.conversation.handoffAt} is null`
    ));
  }
  return { action, idempotent: action !== "reschedule", pending: false };
}
