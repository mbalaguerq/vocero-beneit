import { desc } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfiguredFor } from "@/lib/ai/provider";
import { leerConfigDespacho } from "@/server/brains/config";
import { RunConflictError, startRun } from "@/server/lab/runner";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  return Response.json({
    runs: withDelta,
    aiConfigured: await isAiConfiguredFor(session.organizationId),
    // 036 — Sin cerebro conectado, la pantalla lo dice en vez de ofrecer correr.
    brainConnected: leerConfigDespacho().active,
  });
});

export const POST = withAuth(async (session, request: Request) => {
  // 036 — El Laboratorio prueba al cerebro conectado: sin él no hay a quién.
  if (!leerConfigDespacho().active) {
    return apiError(
      409,
      "sin_cerebro",
      "Conecta el agente para ejecutar el Laboratorio y probar las respuestas que reciben tus clientes."
    );
  }
  if (!(await isAiConfiguredFor(session.organizationId))) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura el proveedor de IA en Ajustes → IA para ejecutar el Laboratorio."
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { suite?: unknown };
    if (body.suite !== undefined && body.suite !== "default" && body.suite !== "fase6") {
      return apiError(400, "suite_invalid", "La batería solicitada no existe.");
    }
    const runId = await startRun(session.organizationId, body.suite === "fase6" ? "fase6" : "default");
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una evaluación en curso; espera a que termine."
      );
    }
    throw err;
  }
});
