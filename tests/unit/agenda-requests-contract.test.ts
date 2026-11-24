import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/server/agenda/requests.ts", "utf8");

describe("peticiones a Agenda", () => {
  it("manté el filtre de converses reals i només l'obre amb el guard D-1", () => {
    expect(source).toContain("isD1TestDataEnabled");
    expect(source).toContain("eq(schema.conversation.isTest, false)");
    expect(source).toContain("isD1TestDataEnabled() ? []");
  });

  it("no converteix una petició de servei en una reserva sense startUtc", () => {
    expect(source).not.toContain("createSessionBooking");
    expect(source).not.toContain("startUtc");
  });
});
