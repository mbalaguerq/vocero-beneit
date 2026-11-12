import {
  CalendarDays,
  ChartColumn,
  FlaskConical,
  Inbox,
  Kanban,
  ListChecks,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { canConfigure } from "@/lib/auth/roles";

/**
 * #87 — El modelo del menú, separado del componente que lo pinta.
 *
 * Qué entradas existen lo deciden dos cosas que el nav de cliente no puede
 * leer solo: las banderas de la instancia (`AGENDA`, `CHANNELS`, `ATRIBUCION`,
 * que bajan por prop desde el servidor) y el rol de quien mira. Tenerlo aquí,
 * sin React, deja que una prueba unitaria afirme qué aparece y qué no sin
 * dibujar nada.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de no leídos (solo la Bandeja). */
  badge?: boolean;
  /** Enllaços externs (com l'agenda de proves) s'obren en una pestanya nova. */
  external?: boolean;
};

export type NavGroup = {
  /** Encabezado pequeño; sin él, el grupo es una entrada suelta. */
  title?: string;
  items: NavItem[];
};

/** La única entrada que va abajo, separada del resto. */
export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Configuració",
  icon: Settings,
};

/**
 * Grupos de la barra lateral, en el orden en que se leen: lo que se atiende
 * cada día, lo que configura al agente y, al final, cómo va el negocio.
 */
export function appNavGroups({
  agenda = false,
  role,
}: {
  /** 015 — "Citas" solo existe si esta instancia encendió la agenda. */
  agenda?: boolean;
  /** #86 — La guía de inicio solo para quien puede configurar. */
  role?: string | null;
}): NavGroup[] {
  const trabajo: NavItem[] = [
    { href: "/inbox", label: "Safata", icon: Inbox, badge: true },
    { href: "/pipeline", label: "Embuts", icon: Kanban },
    { href: "/contacts", label: "Contactes", icon: Users },
  ];
  // Agenda va después de Contactes: és el pas següent d'una petició, no una
  // sección aparte.
  // L'Agenda operativa de Beneït és una aplicació separada. El CRM conserva
  // les peticions i la integració API, però l'entrada visible ha d'obrir
  // l'agenda real i no el calendari intern de demostració de Vocero.
  if (agenda) trabajo.push({ href: "https://proves.instalabeneit.es/", label: "Agenda", icon: CalendarDays, external: true });

  const agente: NavItem[] = [];
  // Un miembro del equipo no puede hacer ninguno de los pasos de la guía.
  if (canConfigure(role)) {
    agente.push({ href: "/onboarding", label: "Guia d'inici", icon: ListChecks });
  }
  agente.push(
    { href: "/agent", label: "Agent", icon: Sparkles },
    { href: "/lab", label: "Laboratori", icon: FlaskConical }
  );

  return [
    { title: "Feina", items: trabajo },
    { title: "Agente", items: agente },
    // 019 — Se mide al final: primero se atiende y se organiza.
    { items: [{ href: "/results", label: "Resultats", icon: ChartColumn }] },
  ];
}

export type SettingsLink = { href: string; label: string };

export type SettingsSection = {
  title: string;
  links: SettingsLink[];
};

/**
 * Ajustes en tres secciones: por dónde entran los mensajes, qué hace el agente
 * con ellos y lo que es del negocio. Una pestaña por canal no escala; una
 * sección por canal, sí: cada canal nuevo cae en "Canales" sin tocar el resto.
 *
 * Instagram no tiene pantalla propia todavía: sus credenciales se guardan
 * por API (`/api/settings/instagram`). Cuando la tenga, va aquí tras
 * `CHANNELS`, igual que Messenger.
 */
export function settingsSections({
  agenda = false,
  atribucion = false,
  instagram = false,
  messenger = false,
  tiktok = false,
}: {
  agenda?: boolean;
  /** 016 — "Anuncios" existe solo con la bandera ATRIBUCION. */
  atribucion?: boolean;
  /** 023 — "Instagram" solo si el canal está encendido con CHANNELS. */
  instagram?: boolean;
  /** 017 — "Messenger", igual. */
  messenger?: boolean;
  /** 022 — "TikTok", igual: solo con el canal en CHANNELS. */
  tiktok?: boolean;
}): SettingsSection[] {
  const canales: SettingsLink[] = [];
  // 023 — "Estado" reúne todos los canales; con WhatsApp solo no aporta nada
  // que su pantalla no diga, así que no existe (ADR-001).
  if (instagram || messenger || tiktok) {
    canales.push({ href: "/settings/channels", label: "Estat" });
  }
  canales.push({ href: "/settings/whatsapp", label: "WhatsApp" });
  if (instagram) canales.push({ href: "/settings/instagram", label: "Instagram" });
  if (messenger) canales.push({ href: "/settings/messenger", label: "Messenger" });
  if (tiktok) canales.push({ href: "/settings/tiktok", label: "TikTok" });

  // #85 — el proveedor de IA se configura aquí; el entorno queda de respaldo.
  const agente: SettingsLink[] = [{ href: "/settings/ai", label: "IA" }];
  if (agenda) agente.push({ href: "/settings/calendar", label: "Agenda" });

  const negocio: SettingsLink[] = [
    { href: "/settings/branding", label: "Marca" },
    { href: "/settings/templates", label: "Plantilles" },
    { href: "/settings/team", label: "Equip" },
  ];
  if (atribucion) negocio.push({ href: "/settings/ads", label: "Anuncis" });

  return [
    { title: "Canals", links: canales },
    { title: "Agent", links: agente },
    { title: "Negoci", links: negocio },
  ];
}

/** Activa si la ruta es la entrada o cuelga de ella (`/inbox/cv_123`). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
