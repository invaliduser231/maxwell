import 'server-only';
import { type TicketPanel, ticketsConfig } from '@maxwell/core/modules/tickets';
import { type Ticket, TicketStore } from '@maxwell/core/stores/tickets';
import { db } from '@/lib/db';
import { botGuild } from '@/lib/fluxer';
import { sessionGuilds } from '@/lib/session';

export interface SupportGuild {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface SupportPanel {
  id: string;
  name: string;
}

export interface SupportTicket {
  id: string;
  number: number;
  panel: string;
  subject: string | null;
  open: boolean;
  createdAt: string;
}

export type SupportState =
  | { kind: 'closed' }
  | { kind: 'not-member'; guild: SupportGuild }
  | { kind: 'ready'; guild: SupportGuild; panels: SupportPanel[]; tickets: SupportTicket[] };

export function panelName(panels: readonly TicketPanel[], ticket: Ticket): string {
  return panels.find((panel) => panel.id === ticket.panelId)?.name ?? ticket.panelId;
}

export async function supportPanels(guildId: string): Promise<TicketPanel[] | null> {
  const state = await db().modules.state(guildId, 'tickets');
  const parsed = ticketsConfig.safeParse(state.config);
  if (!state.enabled || !parsed.success || !parsed.data.webForm) return null;
  return parsed.data.panels;
}

export async function supportState(guildId: string, userId: string): Promise<SupportState> {
  if (!/^\d{1,21}$/.test(guildId)) return { kind: 'closed' };
  const [panels, info] = await Promise.all([supportPanels(guildId), botGuild(guildId)]);
  if (!panels || panels.length === 0 || !info) return { kind: 'closed' };
  const guild = { id: info.id, name: info.name, iconUrl: info.iconUrl };
  const guilds = await sessionGuilds();
  if (!guilds?.some((entry) => entry.id === guildId)) return { kind: 'not-member', guild };
  const tickets = await new TicketStore(db().sql).openedBy(guildId, userId);
  return {
    kind: 'ready',
    guild,
    panels: panels.map((panel) => ({ id: panel.id, name: panel.name })),
    tickets: tickets
      .filter((ticket) => ticket.panelId !== 'modmail')
      .reverse()
      .slice(0, 20)
      .map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        panel: panelName(panels, ticket),
        subject: ticket.subject,
        open: ticket.status === 'open',
        createdAt: ticket.createdAt.toISOString(),
      })),
  };
}
