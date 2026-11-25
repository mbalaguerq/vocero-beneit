import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { applyReminderResponse, runD1ReminderWorker } from "@/server/agenda/reminders";
import { cancelBooking } from "@/server/agenda/service";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";

const fake = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => fake,
}));
vi.mock("@/server/agenda/service", () => ({ cancelBooking: vi.fn(), rescheduleForConversation: vi.fn() }));
const getSettings = vi.hoisted(() => vi.fn(async () => ({ timezone: "UTC" })));
vi.mock("@/server/agenda/settings", () => ({ getSettings }));
vi.mock("@/server/whatsapp/templates", () => ({
  sendTemplate: vi.fn(),
  TemplateError: class TemplateError extends Error {},
}));

const dialect = new PgDialect();
const dueAt = new Date("2026-11-20T10:30:00.000Z");
const reminder = {
  id: "rem_prueba", organizationId: "org_prueba", bookingId: "bk_prueba",
  status: "sending", attempts: 1, dueAt,
};
const template = {
  body: "Hola {{1}}. Responde 1 CONFIRMAR, 2 CANVIAR DATA o 3 CANCEL·LAR.",
  status: "approved",
};
const target = {
  booking: { id: "bk_prueba", status: "agendada", scheduledAt: new Date("2026-11-21T10:30:00.000Z") },
  contact: { name: "Ana" },
  conversation: { id: "cv_prueba" },
};
const options = { organizationId: "org_prueba", template: { templateId: "tpl_prueba", variables: [] }, now: new Date("2026-11-20T11:00:00.000Z") };
const selects: unknown[][] = [];
const returning: unknown[][] = [];
const updates: { values: Record<string, unknown>; condition: SQL }[] = [];

function selectChain(rows: unknown[]) {
  const chain = {
    from: () => chain, innerJoin: () => chain, where: () => chain,
    orderBy: () => chain, limit: async () => rows,
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  returning.length = 0;
  updates.length = 0;
  getSettings.mockClear();
  fake.select.mockImplementation(() => selectChain(selects.shift() ?? []));
  fake.update.mockImplementation(() => {
    let values: Record<string, unknown>;
    const chain = {
      set: (next: Record<string, unknown>) => { values = next; return chain; },
      where: (condition: SQL) => { updates.push({ values, condition }); return chain; },
      returning: async () => returning.shift() ?? [],
      then: (resolve: (value: undefined) => void) => Promise.resolve().then(() => resolve(undefined)),
    };
    return chain;
  });
});

describe("worker D-1", () => {
  it("retorna vacío sin actualizar leases si no hay recordatorios", async () => {
    selects.push([template]);
    fake.execute.mockResolvedValue([]);

    await expect(runD1ReminderWorker(options)).resolves.toEqual({
      processed: 0, sent: 0, cancelled: 0, failed: 0,
    });
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("no vuelve a reclamar una fila que falló en la misma tanda", async () => {
    selects.push([template], [target]);
    returning.push([]); // No hay leases caducados.
    fake.execute.mockImplementation(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      if (compiled.sql.includes("NOT IN")) {
        expect(compiled.params).toContain(reminder.id);
        return [];
      }
      return [reminder];
    });
    vi.mocked(sendTemplate).mockRejectedValue(new TemplateError("invalid", "preenvío"));

    expect(await runD1ReminderWorker(options)).toEqual({ processed: 1, sent: 0, cancelled: 0, failed: 1 });
    expect(getSettings).toHaveBeenCalledWith(reminder.organizationId);
    expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.values.status).toBe("pending");
  });

  it("reclama leases vencidos aunque no haya recordatorios pendientes", async () => {
    selects.push([template]);
    returning.push([{ id: reminder.id }]);
    fake.execute.mockResolvedValue([]);

    expect(await runD1ReminderWorker(options)).toEqual({ processed: 0, sent: 0, cancelled: 0, failed: 1 });
    expect(updates.at(-1)?.values.status).toBe("pending");
    expect(updates.at(-1)?.values.leaseUntil).toBeNull();
  });

  it("comprova l'expiració amb el rellotge de PostgreSQL", async () => {
    selects.push([template]);
    returning.push([{ id: reminder.id }]);
    fake.execute.mockResolvedValue([]);

    await runD1ReminderWorker(options);

    const condition = dialect.sqlToQuery(updates.at(-1)!.condition).sql;
    expect(condition).toContain("CURRENT_TIMESTAMP");
    expect(condition).toContain('"lease_until" <=');
  });

  it("marca como terminal un error de resultado incierto de Meta", async () => {
    selects.push([template], [target]);
    returning.push([]);
    fake.execute.mockResolvedValueOnce([reminder]).mockResolvedValueOnce([]);
    vi.mocked(sendTemplate).mockRejectedValue(new Error("respuesta perdida"));

    expect(await runD1ReminderWorker(options)).toEqual({ processed: 1, sent: 0, cancelled: 0, failed: 1 });
    expect(updates.at(-1)?.values.status).toBe("failed");
    expect(updates.at(-1)?.values.lastError).toContain("incierto");
  });

  it("no informa enviado si falla el marcado posterior al envío", async () => {
    selects.push([template], [target]);
    returning.push([]); // No hay leases caducados.
    fake.execute.mockResolvedValueOnce([reminder]);
    vi.mocked(sendTemplate).mockResolvedValue({ messageId: "msg_prueba", providerMessageId: "wamid_prueba" });
    fake.update.mockImplementationOnce(() => {
      const chain = {
        set: () => chain,
        where: () => chain,
        returning: async () => [],
      };
      return chain;
    });

    expect(await runD1ReminderWorker(options)).toEqual({ processed: 1, sent: 0, cancelled: 0, failed: 1 });
  });

  it("no reenvía una fila recuperada que ya conserva el provider message id", async () => {
    selects.push([template], [target]);
    returning.push([]);
    fake.execute.mockResolvedValueOnce([
      { ...reminder, providerMessageId: "wamid_ja_enviat" },
    ]);

    expect(await runD1ReminderWorker(options)).toEqual({
      processed: 1, sent: 1, cancelled: 0, failed: 0,
    });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.at(-1)?.values.status).toBe("sent");
  });

  it("no deixa que un worker antic escrigui el provider id després del reclaim", async () => {
    selects.push([template], [target]);
    returning.push([]);
    fake.execute.mockResolvedValueOnce([reminder]).mockResolvedValueOnce([]);
    vi.mocked(sendTemplate).mockResolvedValue({ messageId: "msg_prueba", providerMessageId: "wamid_prueba" });

    await runD1ReminderWorker(options);

    const providerUpdate = updates.find((update) => "providerMessageId" in update.values);
    expect(providerUpdate).toBeDefined();
    const condition = dialect.sqlToQuery(providerUpdate!.condition).sql;
    expect(condition).toContain('"status" =');
    expect(condition).toContain('"attempts" =');
    expect(condition).toContain('"worker_id" =');
  });

  it("reclama amb lease, worker id i SKIP LOCKED", async () => {
    selects.push([template], [target]);
    returning.push([]);
    let sawClaim = false;
    fake.execute.mockImplementation(async (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      if (compiled.sql.includes("FOR UPDATE SKIP LOCKED")) {
        sawClaim = true;
        expect(compiled.sql).toContain("claimed_at");
        expect(compiled.sql).toContain("worker_id");
        return [reminder];
      }
      return [reminder];
    });
    vi.mocked(sendTemplate).mockRejectedValue(new TemplateError("invalid", "preenvío"));

    await runD1ReminderWorker(options);
    expect(sawClaim).toBe(true);
  });
});

describe("confirmación auditada", () => {
  it("añade una sola confirmación por vencimiento, incluso tras llamadas repetidas", async () => {
    selects.push(
      [{ reminder: { ...reminder, status: "sent" }, booking: target.booking }],
      [{ reminder: { ...reminder, status: "sent" }, booking: target.booking }]
    );
    returning.push([{ id: reminder.id }], []);
    const input = { organizationId: "org_prueba", reminderId: reminder.id, response: "1" };

    expect(await applyReminderResponse(input)).toEqual({ action: "confirm", idempotent: false });
    expect(await applyReminderResponse(input)).toEqual({ action: "confirm", idempotent: true });
    const append = dialect.sqlToQuery(updates[0]!.values.confirmations as SQL);
    expect(append.sql).toContain("confirmations");
    expect(append.params.join(" ")).toContain(dueAt.toISOString());
    expect(dialect.sqlToQuery(updates[0]!.condition).sql).toContain("@>");
  });

  it("no repite la cancelación externa cuando la respuesta ya fue aplicada", async () => {
    selects.push(
      [{ reminder: { ...reminder, status: "sent" }, booking: { ...target.booking, status: "cancelada" } }]
    );

    await expect(applyReminderResponse({
      organizationId: "org_prueba", reminderId: reminder.id, response: "3",
    })).resolves.toEqual({ action: "cancel", idempotent: true });
    expect(cancelBooking).not.toHaveBeenCalled();
  });
});
