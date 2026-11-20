import { describe, expect, it } from "vitest";
import {
  D1_MAX_ATTEMPTS,
  D1_REMINDER_CONTRACT,
  parseReminderAction,
  reminderDueAt,
  reminderText,
} from "@/server/agenda/reminders";

describe("recordatori D-1", () => {
  it("deriva sempre el venciment a partir de scheduled_at", () => {
    const scheduled = new Date("2026-11-21T10:30:00.000Z");
    expect(reminderDueAt(scheduled).toISOString()).toBe("2026-11-20T10:30:00.000Z");
  });

  it("publica el fallback numerat quan no hi ha botons interactius", () => {
    expect(D1_REMINDER_CONTRACT.interactive).toBe(false);
    expect(reminderText("Ana", new Date("2026-11-21T10:30:00.000Z"), "UTC"))
      .toContain("1 per CONFIRMAR, 2 per CANVIAR DATA o 3 per CANCEL·LAR");
  });

  it.each([
    ["1", "confirm"], ["CONFIRMAR", "confirm"], ["2", "reschedule"],
    ["3", "cancel"], ["cancel·lar", "cancel"], ["persona", "handoff"],
  ] as const)("interpreta %s com %s", (input, expected) => {
    expect(parseReminderAction(input)).toBe(expected);
  });

  it("no interpreta text lliure com una acció", () => {
    expect(parseReminderAction("necessito parlar amb el taller")).toBeNull();
  });

  it("limita els retries", () => {
    expect(D1_MAX_ATTEMPTS).toBe(3);
  });
});
