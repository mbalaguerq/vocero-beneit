import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { applyReminderResponse, runD1ReminderWorker } from "@/server/agenda/reminders";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";

const fake = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => fake,
}));
vi.mock("@/server/agenda/service", () => ({ cancelBooking: vi.fn(), rescheduleForConversation: vi.fn() }));
vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => ({ timezone: "UTC" }) }));
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
    expect(fake.execute).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.values.status).toBe("pending");
  });

  it("cierra un lease vencido como incierto sin reclamarlo", async () => {
    selects.push([template]);
    returning.push([{ id: reminder.id }]);
    fake.execute.mockResolvedValue([]);

    expect(await runD1ReminderWorker(options)).toEqual({ processed: 0, sent: 0, cancelled: 0, failed: 1 });
    expect(updates[0]?.values.status).toBe("failed");
    expect(dialect.sqlToQuery(updates[0]!.condition).sql).toContain("lease_until");
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
    vi.mocked(sendTemplate).mockResolvedValue({ messageId: "wamid_prueba" });
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
});
