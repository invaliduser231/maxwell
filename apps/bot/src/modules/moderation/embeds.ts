import type { CaseAction } from '@maxwell/core/modules/moderation';
import type { CaseRow } from '@maxwell/core/stores/moderation';
import { mention } from '../../commands/mentions.js';
import type { Embed, EmbedField, UserRef } from '../../platform/types.js';
import { timestamp } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { copy } from './copy.js';
import { clip, humanDuration } from './text.js';

const tones: Record<CaseAction, number> = {
  ban: palette.danger,
  kick: palette.danger,
  timeout: palette.warning,
  warn: palette.warning,
  flag: palette.warning,
  unban: palette.success,
  untimeout: palette.success,
};

export function caseColor(row: Pick<CaseRow, 'action' | 'voidedAt'>): number {
  return row.voidedAt ? palette.muted : tones[row.action];
}

export function userLabel(user: UserRef): string {
  return user.displayName === user.username
    ? `@${user.username}`
    : `${user.displayName} (@${user.username})`;
}

export function moderatorLabel(moderatorId: string | null, external: boolean): string {
  if (moderatorId) return mention.user(moderatorId);
  return external ? copy.unknown : copy.maxwell;
}

export function caseDuration(row: Pick<CaseRow, 'action' | 'durationSeconds'>): string | null {
  if (row.action !== 'ban' && row.action !== 'timeout') return null;
  if (row.durationSeconds === null) return row.action === 'ban' ? copy.permanent : null;
  return humanDuration(row.durationSeconds * 1_000);
}

export function caseEmbed(row: CaseRow, user: UserRef | null, prefix: string): Embed {
  const external = row.meta.external === true;
  const fields: EmbedField[] = [];
  if (row.userId)
    fields.push({ name: copy.fields.member, value: mention.user(row.userId), inline: true });
  fields.push({
    name: copy.fields.moderator,
    value: moderatorLabel(row.moderatorId, external),
    inline: true,
  });
  const duration = caseDuration(row);
  if (duration) {
    const until = row.expiresAt ? ` (${timestamp(row.expiresAt, 'R')})` : '';
    fields.push({ name: copy.fields.duration, value: `${duration}${until}`, inline: true });
  }

  const suggestion = row.action === 'flag' ? flagSuggestion(row) : null;
  const reason = row.reason ? clip(row.reason, 1_000) : copy.reasonHint(prefix, row.number);
  fields.push({
    name: copy.fields.reason,
    value: suggestion ? `${reason}\n${suggestion}` : reason,
  });

  if (row.excerpt) {
    fields.push({ name: copy.fields.excerpt, value: clip(quote(row.excerpt), 1_000) });
  }
  if (row.evidence.length) {
    fields.push({ name: copy.fields.evidence, value: clip(row.evidence.join('\n'), 1_000) });
  }
  if (row.editedBy && row.editedAt) {
    fields.push({
      name: copy.fields.editedBy,
      value: `${mention.user(row.editedBy)} ${timestamp(row.editedAt, 'R')}`,
      inline: true,
    });
  }
  const review = typeof row.meta.review === 'string' ? row.meta.review : null;
  if (review) fields.push({ name: copy.fields.ended, value: review });
  if (row.voidedAt) {
    fields.push({
      name: copy.fields.voided,
      value: copy.voidedLine(
        moderatorLabel(row.voidedBy, false),
        timestamp(row.voidedAt, 'R'),
        row.voidReason,
      ),
    });
  }

  return {
    color: caseColor(row),
    author: user ? { name: userLabel(user), iconUrl: user.avatarUrl } : undefined,
    title: copy.caseTitle(row.number, copy.actions[row.action], row.voidedAt !== null),
    fields,
    footer: copy.caseFooter(row.userId, row.number),
    timestamp: row.createdAt,
  };
}

function flagSuggestion(row: CaseRow): string | null {
  const action = row.meta.suggested;
  if (action !== 'timeout' && action !== 'kick' && action !== 'ban') return null;
  const minutes = typeof row.meta.durationMinutes === 'number' ? row.meta.durationMinutes : null;
  return copy.reviewSuggestion(action, minutes ? humanDuration(minutes * 60_000) : null);
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function channelLogEmbed(input: {
  title: string;
  channelId: string;
  moderatorId: string | null;
  reason: string | null;
  detail?: string | null;
  color?: number;
}): Embed {
  const fields: EmbedField[] = [
    { name: copy.fields.channel, value: mention.channel(input.channelId), inline: true },
    { name: copy.fields.moderator, value: moderatorLabel(input.moderatorId, false), inline: true },
  ];
  if (input.reason) fields.push({ name: copy.fields.reason, value: clip(input.reason, 1_000) });
  return {
    color: input.color ?? palette.south,
    title: input.title,
    description: input.detail ?? undefined,
    fields,
    footer: copy.channelFooter(input.channelId),
    timestamp: new Date(),
  };
}
