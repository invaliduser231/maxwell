import 'server-only';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import { APPEAL_WAIT_DAYS, type InboxItem, InboxStore } from '@maxwell/core/stores/inbox';
import { ModerationStore } from '@maxwell/core/stores/moderation';
import { db } from '@/lib/db';
import { botGuild } from '@/lib/fluxer';

const DAY = 86_400_000;

export interface AppealGuild {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface AppealSummary {
  number: number;
  status: InboxItem['status'];
  body: string | null;
  createdAt: string;
}

export type AppealState =
  | { kind: 'closed' }
  | { kind: 'not-banned'; guild: AppealGuild }
  | { kind: 'open'; guild: AppealGuild; appeal: AppealSummary }
  | { kind: 'wait'; guild: AppealGuild; appeal: AppealSummary; until: string }
  | { kind: 'ready'; guild: AppealGuild; banCase: number; last: AppealSummary | null };

function summary(item: InboxItem | null): AppealSummary | null {
  if (!item) return null;
  return {
    number: item.number,
    status: item.status,
    body: item.body,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function appealState(guildId: string, userId: string): Promise<AppealState> {
  if (!/^\d{1,21}$/.test(guildId)) return { kind: 'closed' };
  const [state, info] = await Promise.all([
    db().modules.state(guildId, 'moderation'),
    botGuild(guildId),
  ]);
  const parsed = moderationConfig.safeParse(state.config);
  if (!info || !state.enabled || !parsed.success || !parsed.data.appeals) return { kind: 'closed' };
  const guild = { id: info.id, name: info.name, iconUrl: info.iconUrl };

  const inbox = new InboxStore(db().sql);
  const last = await inbox.latestAppeal(guildId, userId);
  const appeal = summary(last);
  if (last && appeal && (last.status === 'open' || last.status === 'claimed')) {
    return { kind: 'open', guild, appeal };
  }
  const ban = await new ModerationStore(db().sql).openCase(guildId, userId, 'ban');
  if (!ban) return { kind: 'not-banned', guild };
  if (last?.resolvedAt && appeal) {
    const until = last.resolvedAt.getTime() + APPEAL_WAIT_DAYS * DAY;
    if (until > Date.now()) {
      return { kind: 'wait', guild, appeal, until: new Date(until).toISOString() };
    }
  }
  return { kind: 'ready', guild, banCase: ban.number, last: appeal };
}
