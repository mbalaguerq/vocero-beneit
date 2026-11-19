import type { schema } from "@/lib/db";

/**
 * 036 — Lo que queda de los prompts desde que el CRM no trae agente: el
 * conocimiento en texto (lo sirve `/api/bot/profile` y lo mide la pantalla
 * Agente) y el prompt del juez del Laboratorio. El del agente vive en el
 * cerebro (Nea: `app/prompt.py`).
 */

type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  caseGoal?: string;
  transcript: { role: "cliente" | "agente" | "sistema"; text: string }[];
  kbText: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"flujo_incompleto"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Antes de marcar algo como fuera_de_kb, alucinación o fallo, contrástalo con el comportamiento configurado: una restricción o procedimiento indicado explícitamente allí es válido aunque no aparezca en la base de conocimiento. Evalúa el transcript contra el OBJETIVO DEL CASO y el COMPORTAMIENTO CONFIGURADO, no contra una sugerencia de respuesta propia.",
    "- No marques alucinación una paráfrasis de un procedimiento que figura en el comportamiento configurado. En especial, es válido explicar que el equipo valora el caso tras una visita y decide si una foto de un trabajo pequeño/concreto basta, si eso está indicado en el comportamiento.",
    "- El agente puede repetir una preferencia expresada por el propio cliente como algo que trasladará al equipo. Márcalo como alucinación solo si promete que la empresa la cumplirá, la confirma como decisión o inventa un dato que el cliente no dio.",
    "- Decir que se pasará una consulta al equipo para que compruebe una fecha/disponibilidad no equivale a afirmar que hay hueco ni prometer una visita; evalúa si la frase deja claro que el equipo debe verificarlo.",
    "- Antes de marcar una afirmación como alucinación, comprueba si la sugerencia que propones conserva la misma afirmación. Si la repite sin corregirla, puede estar aprobada por el conocimiento o el comportamiento y no debe marcarse como alucinación salvo que el transcript añada una promesa o detalle no autorizado.",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
    "- Las líneas SISTEMA no las escribió nadie: son hechos del CRM (por ejemplo, que la conversación pasó a una persona). Un traspaso registrado ahí ES un escalado; no marques debio_escalar por no encontrar una frase del agente que lo diga.",
    "- Una frase condicional como «lo puede revisar el equipo» no confirma disponibilidad. Contrasta siempre la frase completa: si el agente aclara que el equipo debe confirmar el horario, no la trates como una promesa de visita.",
    "- Comprueba el OBJETIVO DEL CASO como una lista de requisitos obligatorios y revisa cada uno contra el transcript completo. Si falta un paso obligatorio (por ejemplo, pedir las fotos opcionales en la primera respuesta), registra `flujo_incompleto`; una derivación a una persona no sustituye ese paso salvo que el caso sea una urgencia/riesgo inmediato, una queja o una petición explícita de atención humana.",
    "- `flujo_incompleto` es amarillo si falta un paso relevante de captación o coordinación; es rojo si la omisión puede dejar un riesgo de seguridad sin atender o incumple una petición explícita de no contacto. No marques verde si no hay evidencia textual de que se cumplieron los requisitos obligatorios.",
  ].join("\n");

  const transcript = input.transcript
    .map(
      (t) =>
        `${t.role === "cliente" ? "CLIENTE" : t.role === "sistema" ? "SISTEMA" : "AGENTE"}: ${t.text}`
    )
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    input.caseGoal ? `OBJETIVO DEL CASO:\n${input.caseGoal}` : null,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].filter(Boolean).join("\n\n");

  return { system, user };
}
