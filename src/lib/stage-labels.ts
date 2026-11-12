/** Etiquetes visibles del pipeline. Els noms nous són operatius i en català;
 * conservem els noms antics per renderitzar amb coherència organitzacions ja
 * sembrades abans de l'actualització. */
const STAGE_LABELS: Record<string, string> = {
  "Nuevo": "Nou",
  "En conversación": "En conversa",
  "Interesado": "Interessat",
  "Cliente": "Client",
  "Perdido": "Perdut",
  "Nova consulta": "Nova consulta",
  "Recollint dades": "Recollint dades",
  "Revisió de l'equip": "Revisió de l'equip",
  "Proposta de visita": "Proposta de visita",
  "Visita confirmada": "Visita confirmada",
  "Client / feina en curs": "Client / feina en curs",
  "Tancada / Perduda": "Tancada / Perduda",
};

export function stageLabel(name: string): string {
  return STAGE_LABELS[name.trim()] ?? name;
}
