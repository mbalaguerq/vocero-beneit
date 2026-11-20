import { and, eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { cancelBooking, rescheduleForConversation } from "@/server/agenda/service";
import { sendTemplate } from "@/server/whatsapp/templates";

export const D1_MAX_ATTEMPTS = 3;
export const D1_LEASE_MS = 5 * 60_000;
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

export type ReminderAction = "confirm" | "reschedule" | "cancel" | "handoff";
export type D1ReminderTemplateConfig = { templateId: string; variables: string[] };

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

export function parseReminderAction(input: string): ReminderAction | null {
  const value = input.trim().toLocaleLowerCase("es-ES");
  if (["1", "confirmar", "confirmo", "sí", "si"].includes(value)) return "confirm";
  if (["2", "cambiar", "cambiar fecha", "canviar data"].includes(value)) return "reschedule";
  if (["3", "cancelar", "cancel·lar", "cancel·lar cita"].includes(value)) return "cancel";
  if (["humano", "persona", "agente"].includes(value)) return "handoff";
  return null;
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
    set: { dueAt, status: "pending", leaseUntil: null, lastError: null, updatedAt: new Date() },
  });
}

export async function cancelBookingReminder(organizationId: string, bookingId: string): Promise<void> {
  const now = new Date();
  await getDb().update(schema.bookingReminder).set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(scoped(schema.bookingReminder.organizationId, organizationId, and(
      eq(schema.bookingReminder.bookingId, bookingId),
      or(eq(schema.bookingReminder.status, "pending"), eq(schema.bookingReminder.status, "sending"))
    )));
}

/** Claim atòmic amb FOR UPDATE SKIP LOCKED: dos workers no poden enviar la mateixa fila. */
export async function claimD1Reminder(now = new Date()): Promise<typeof schema.bookingReminder.$inferSelect | null> {
  const leaseUntil = new Date(now.getTime() + D1_LEASE_MS);
  const result = await getDb().execute(sql`
    WITH candidate AS (
      SELECT id FROM booking_reminder
      WHERE type = 'd1' AND status IN ('pending', 'failed') AND due_at <= ${now}
        AND attempts < ${D1_MAX_ATTEMPTS} AND (lease_until IS NULL OR lease_until < ${now})
      ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE booking_reminder AS reminder
    SET status = 'sending', attempts = reminder.attempts + 1,
        lease_until = ${leaseUntil}, updated_at = ${now}
    FROM candidate WHERE reminder.id = candidate.id RETURNING reminder.*
  `);
  const row = (result as unknown as Record<string, unknown>[])[0];
  return (row as typeof schema.bookingReminder.$inferSelect | undefined) ?? null;
}

export async function runD1ReminderWorker(input: {
  template: D1ReminderTemplateConfig;
  now?: Date;
}): Promise<"sent" | "cancelled" | "failed" | "idle"> {
  const now = input.now ?? new Date();
  const reminder = await claimD1Reminder(now);
  if (!reminder) return "idle";
  const rows = await getDb().select({ booking: schema.booking, contact: schema.contact, conversation: schema.conversation })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.booking.conversationId))
    .where(scoped(schema.booking.organizationId, reminder.organizationId, and(
      eq(schema.booking.id, reminder.bookingId), eq(schema.booking.kind, "session"),
      eq(schema.booking.status, "agendada"), eq(schema.booking.isTest, false),
      eq(schema.conversation.isTest, false)
    ))).limit(1);
  const target = rows[0];
  if (!target) { await cancelBookingReminder(reminder.organizationId, reminder.bookingId); return "cancelled"; }
  try {
    await sendTemplate({ organizationId: reminder.organizationId, conversationId: target.conversation.id, templateId: input.template.templateId, variables: input.template.variables });
    await getDb().update(schema.bookingReminder).set({ status: "sent", sentAt: now, leaseUntil: null, updatedAt: now }).where(eq(schema.bookingReminder.id, reminder.id));
    return "sent";
  } catch (error) {
    await getDb().update(schema.bookingReminder).set({ status: reminder.attempts >= D1_MAX_ATTEMPTS ? "failed" : "pending", leaseUntil: null, lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown_error", updatedAt: now }).where(eq(schema.bookingReminder.id, reminder.id));
    return "failed";
  }
}

export async function applyReminderResponse(input: {
  organizationId: string;
  reminderId?: string;
  conversationId?: string;
  response: string;
  newStartUtc?: string;
}): Promise<{ action: ReminderAction | "unknown"; idempotent: boolean }> {
  const action = parseReminderAction(input.response);
  if (!action) return { action: "unknown", idempotent: true };
  const rows = await getDb().select({ reminder: schema.bookingReminder, booking: schema.booking })
    .from(schema.bookingReminder).innerJoin(schema.booking, eq(schema.booking.id, schema.bookingReminder.bookingId))
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.booking.conversationId))
    .where(scoped(schema.bookingReminder.organizationId, input.organizationId, and(
      input.reminderId
        ? eq(schema.bookingReminder.id, input.reminderId)
        : eq(schema.conversation.id, input.conversationId ?? ""),
      or(eq(schema.bookingReminder.status, "sent"), eq(schema.bookingReminder.status, "pending"), eq(schema.bookingReminder.status, "sending"))
    ))).orderBy(sql`${schema.bookingReminder.createdAt} desc`).limit(1);
  const row = rows[0];
  if (!row) throw new Error("recordatorio no encontrado");
  if (action === "confirm") return { action, idempotent: row.reminder.status === "sent" };
  if (action === "cancel") {
    await cancelBooking({ organizationId: input.organizationId, bookingId: row.booking.id });
    await cancelBookingReminder(input.organizationId, row.booking.id);
    return { action, idempotent: row.booking.status === "cancelada" };
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
  return { action, idempotent: true };
}
