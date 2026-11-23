import { describe, expect, it, vi } from "vitest";
import { invokeD1Proves } from "../../scripts/cron-d1-proves.mjs";

const input = {
  appBaseUrl: "https://vocero.instalabeneit.es",
  botApiKey: "llave-de-prueba-no-real",
  templateId: "tpl_prueba",
};

describe("cron D-1 de PROVES", () => {
  it("rechaza cualquier otro destino antes de enviar", async () => {
    const fetchImpl = vi.fn();
    await expect(invokeD1Proves({ ...input, appBaseUrl: "https://otro.example", fetchImpl }))
      .rejects.toThrow("URL exacta");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechaza la ausencia de clave o plantilla antes de enviar", async () => {
    const fetchImpl = vi.fn();
    await expect(invokeD1Proves({ ...input, botApiKey: "", fetchImpl })).rejects.toThrow("BOT_API_KEY");
    await expect(invokeD1Proves({ ...input, templateId: "", fetchImpl })).rejects.toThrow("templateId");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invoca solo el endpoint existente y registra los contadores", async () => {
    const result = { processed: 1, sent: 1, cancelled: 0, failed: 0 };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result }) });
    await expect(invokeD1Proves({ ...input, fetchImpl })).resolves.toEqual(result);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://vocero.instalabeneit.es/api/bot/reminders/run",
      expect.objectContaining({
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", "X-API-Key": input.botApiKey },
        body: JSON.stringify({ templateId: input.templateId }),
      })
    );
  });
});
