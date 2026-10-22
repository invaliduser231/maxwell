import {
  type TicketPanel,
  type TicketPanelKind,
  type TicketsConfig,
  ticketsConfig,
} from '@maxwell/core/modules/tickets';

export { type TicketPanel, type TicketsConfig, ticketsConfig };

export const MODULE = 'tickets';
export const MODMAIL_PANEL = 'modmail';

export interface TicketTarget {
  id: string;
  kind: TicketPanelKind | 'modmail';
  name: string;
  categoryId: string | null;
  teamRoleIds: string[];
  pingTeam: boolean;
  openMessage: string;
  channelName: string;
  maxOpenPerMember: number;
}

export function panelTarget(panel: TicketPanel): TicketTarget {
  return {
    id: panel.id,
    kind: panel.kind,
    name: panel.name,
    categoryId: panel.categoryId,
    teamRoleIds: panel.teamRoleIds,
    pingTeam: panel.pingTeam,
    openMessage: panel.openMessage,
    channelName: panel.channelName,
    maxOpenPerMember: panel.maxOpenPerMember,
  };
}

export function modmailTarget(config: TicketsConfig): TicketTarget {
  return {
    id: MODMAIL_PANEL,
    kind: 'modmail',
    name: 'Modmail',
    categoryId: config.modmail.categoryId,
    teamRoleIds: config.modmail.teamRoleIds,
    pingTeam: config.modmail.pingTeam,
    openMessage: config.modmail.openMessage,
    channelName: 'modmail-{user}',
    maxOpenPerMember: 1,
  };
}

export function resolveTarget(config: TicketsConfig, panelId: string): TicketTarget | null {
  if (panelId === MODMAIL_PANEL) return modmailTarget(config);
  const panel = config.panels.find((candidate) => candidate.id === panelId);
  return panel ? panelTarget(panel) : null;
}

export function findPanel(config: TicketsConfig, query: string): TicketPanel | null {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;
  return (
    config.panels.find((panel) => panel.id === wanted) ??
    config.panels.find((panel) => panel.name.toLowerCase() === wanted) ??
    null
  );
}
