"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const WON_RESULTS = [
  ["client_confirmat", "Client confirmat"],
  ["pressupost_acceptat", "Pressupost acceptat"],
  ["treball_realitzat", "Treball realitzat"],
  ["altre", "Altre resultat"],
] as const;

export function WonResultDialog({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (result: string, note: string) => void;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onCancel}>
      <div role="dialog" aria-label="Resultat de la feina" className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-semibold">Tancar amb èxit</h3>
        <p className="mb-4 text-xs text-text-3">{leadName} passa a una etapa guanyada. Quin ha estat el resultat?</p>
        <div className="space-y-2">
          {WON_RESULTS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={result === value} onClick={() => setResult(value)} className={result === value ? "w-full rounded-md border border-brand bg-brand-tint px-3 py-2 text-left text-sm font-medium" : "w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-subtle"}>{label}</button>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          <label className="text-sm font-medium" htmlFor="won-note">Nota (opcional)</label>
          <Textarea id="won-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: feina finalitzada i cobrada" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel·la</Button>
          <Button disabled={!result} onClick={() => result && onConfirm(result, note.trim())}>Marca com a guanyada</Button>
        </div>
      </div>
    </div>
  );
}
