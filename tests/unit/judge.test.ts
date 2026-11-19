import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import { computeScore, judgeCase } from "@/server/lab/judge";
import { buildJudgePrompt } from "@/server/ai/prompts";

describe("prompt del juez del Laboratorio", () => {
  it("comprueba requisitos obligatorios aunque la conversación haga handoff", () => {
    const prompt = buildJudgePrompt({
      persona: "fotos_ja_adjuntes",
      caseGoal: "No volver a pedir las fotos que ya están adjuntas.",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(prompt.system).toContain("OBJETIVO DEL CASO como una lista de requisitos obligatorios");
    expect(prompt.system).toContain("una derivación a una persona no sustituye ese paso");
    expect(prompt.system).toContain("flujo_incompleto");
  });
});

describe("judgeCase (FR-032)", () => {
  beforeEach(() => chatJson.mockReset());

  it("veredicto válido → done", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "verde", hallazgos: [] },
      raw: "{}",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "comprador_decidido",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome.status).toBe("done");
    // usa el modelo del juez (opts.judge)
    expect(chatJson.mock.calls[0]![2]).toMatchObject({ judge: true });
  });

  it("no penaliza la falta de escalado si el CRM registra el traspaso", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "debio_escalar",
            evidencia: "El cliente pidió ayuda humana.",
          },
        ],
      },
      raw: "{}",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "hostil",
      transcript: [
        { role: "cliente", text: "Necesito hablar con alguien." },
        { role: "sistema", text: "La conversación pasó a una persona (motivo: cliente)." },
      ],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome).toMatchObject({
      status: "done",
      verdict: { veredicto: "verde", hallazgos: [] },
    });
  });

  it("conserva requisitos omitidos aunque el CRM registre el traspaso", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: {
        veredicto: "amarillo",
        hallazgos: [
          {
            tipo: "flujo_incompleto",
            evidencia: "No se pidieron las fotos opcionales en la primera respuesta.",
          },
        ],
      },
      raw: "{}",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "reparacio_endolls_instalacio",
      caseGoal: "Pedir fotos opcionales antes del handoff.",
      transcript: [
        { role: "cliente", text: "Tengo una consulta eléctrica." },
        { role: "agente", text: "Lo paso al equipo." },
        { role: "sistema", text: "La conversación pasó a una persona (motivo: modelo)." },
      ],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome).toMatchObject({
      status: "done",
      verdict: { veredicto: "amarillo", hallazgos: [{ tipo: "flujo_incompleto" }] },
    });
  });

  it("salida inválida tras reintentos internos → judge_failed (no lanza)", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "invalid_output",
      detail: "no cumple el esquema (raw=...)",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "fuera_de_kb",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(outcome.status).toBe("judge_failed");
  });
});

describe("computeScore (FR-033: judge_failed excluido del denominador)", () => {
  it("pondera verde=1, amarillo=0.5, rojo=0", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "amarillo" },
      { status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // (1 + 0.5 + 0) / 3 = 0.5
  });

  it("judge_failed NO cuenta en el denominador", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100); // 2/2, no 2/3
  });

  it("todo judge_failed → sin score (null)", () => {
    expect(
      computeScore([{ status: "judge_failed", veredicto: null }])
    ).toBeNull();
  });

  it("6 verdes → 100; 6 rojos → 0", () => {
    const verdes = Array(6).fill({ status: "done", veredicto: "verde" });
    const rojos = Array(6).fill({ status: "done", veredicto: "rojo" });
    expect(computeScore(verdes)).toBe(100);
    expect(computeScore(rojos)).toBe(0);
  });
});
