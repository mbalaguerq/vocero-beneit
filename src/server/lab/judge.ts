import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { buildJudgePrompt } from "@/server/ai/prompts";

/** Veredicto estructurado del juez (FR-032, contrato ai.md). */
export const Verdict = z.object({
  veredicto: z.enum(["verde", "amarillo", "rojo"]),
  hallazgos: z.array(
    z.object({
      tipo: z.enum([
        "alucinacion",
        "fuera_de_kb",
        "debio_escalar",
        "flujo_incompleto",
        "tono",
      ]),
      evidencia: z.string(),
      sugerencia: z
        .object({ pregunta: z.string(), respuesta: z.string() })
        .optional(),
    })
  ),
});

export type VerdictType = z.infer<typeof Verdict>;

export type JudgeOutcome =
  | { status: "done"; verdict: VerdictType }
  | { status: "judge_failed"; detail: string };

/**
 * UNA llamada del juez por conversación. Los reintentos viven dentro de
 * chatJson; si aun así la salida es inválida, el caso queda judge_failed —
 * visible en el reporte y excluido del score. La corrida continúa.
 */
export async function judgeCase(input: {
  /** De quién es la configuración de IA con la que juzga. */
  organizationId: string;
  personaKey: string;
  personaLabel?: string;
  /** Criterio específico del escenario simulado, cuando existe. */
  caseGoal?: string;
  transcript: { role: "cliente" | "agente" | "sistema"; text: string }[];
  kbText: string;
  behaviorText: string;
}): Promise<JudgeOutcome> {
  const { system, user } = buildJudgePrompt({
    persona: input.personaLabel ?? input.personaKey,
    caseGoal: input.caseGoal,
    transcript: input.transcript,
    kbText: input.kbText,
    behaviorText: input.behaviorText,
  });
  const result = await chatJson(
    Verdict,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { judge: true, organizationId: input.organizationId }
  );
  if (!result.ok) {
    // Diagnóstico operativo: el caso queda visible como judge_failed y aquí
    // queda el porqué (incluye el raw= truncado del proveedor).
    console.error(
      `[lab] juez falló para ${input.personaKey}: ${result.error} — ${result.detail}`
    );
    return { status: "judge_failed", detail: result.detail };
  }
  // El traspaso es un hecho persistido por el CRM. El juez LLM puede pasar
  // por alto la línea SISTEMA y proponer "debió escalar" aunque el traspaso
  // figure en el transcript; no permitimos que ese falso positivo altere la
  // puntuación. Los demás hallazgos se conservan íntegros.
  const huboTraspaso = input.transcript.some(
    (m) =>
      m.role === "sistema" &&
      /pasó a una persona|passà a una persona|s'ha derivat a una persona/i.test(
        m.text
      )
  );
  if (!huboTraspaso) return { status: "done", verdict: result.data };

  const hallazgos = result.data.hallazgos.filter(
    (hallazgo) => hallazgo.tipo !== "debio_escalar"
  );
  if (hallazgos.length === result.data.hallazgos.length) {
    return { status: "done", verdict: result.data };
  }

  const veredicto =
    hallazgos.length > 0 &&
    (result.data.veredicto === "rojo" ||
      hallazgos.some(
        (hallazgo) =>
          hallazgo.tipo === "alucinacion" || hallazgo.tipo === "fuera_de_kb"
      ))
    ? "rojo"
    : hallazgos.length > 0
      ? "amarillo"
      : "verde";
  return { status: "done", verdict: { veredicto, hallazgos } };
}

/**
 * Score 0-100: % ponderado de conversaciones verdes (FR-033).
 * verde = 1 · amarillo = 0.5 · rojo = 0. judge_failed fuera del denominador.
 */
export function computeScore(
  cases: { status: string; veredicto: string | null }[]
): number | null {
  const judged = cases.filter(
    (c) => c.status === "done" && c.veredicto !== null
  );
  if (judged.length === 0) return null;
  const points = judged.reduce((acc, c) => {
    if (c.veredicto === "verde") return acc + 1;
    if (c.veredicto === "amarillo") return acc + 0.5;
    return acc;
  }, 0);
  return Math.round((100 * points) / judged.length);
}
