import { ShieldStore } from '@maxwell/core/stores/shield';
import { mention } from '../../commands/mentions.js';
import type { Embed, EmbedField } from '../../platform/types.js';
import { palette } from '../../ui/palette.js';
import { checkTarget, type TargetProblem } from './access.js';
import { copy } from './copy.js';
import { moderatorLabel } from './embeds.js';
import { ActionError, type ModerationService } from './service.js';
import { clip } from './text.js';

export interface MassBanInput {
  guildId: string;
  userIds: readonly string[];
  moderatorId: string;
  reason: string | null;
  deleteMessageSeconds: number | null;
  source: 'command' | 'dashboard';
  batch: string;
  shield?: boolean;
  summary?: boolean;
}

export type SkipReason = TargetProblem | 'banned';

export interface MassBanResult {
  total: number;
  banned: { userId: string; number: number }[];
  skipped: { userId: string; why: SkipReason }[];
  failed: string[];
}

export type MassBanProgress = (done: number, total: number) => Promise<void> | void;

export async function massBan(
  moderation: ModerationService,
  input: MassBanInput,
  progress?: MassBanProgress,
): Promise<MassBanResult> {
  const { platform, log, sql } = moderation.services;
  const { guildId, moderatorId } = input;
  const result: MassBanResult = {
    total: input.userIds.length,
    banned: [],
    skipped: [],
    failed: [],
  };
  let done = 0;
  for (const userId of input.userIds) {
    const check = await checkTarget(platform, {
      guildId,
      actorId: moderatorId,
      targetId: userId,
      needsMember: false,
      botAction: true,
    });
    if (check.problem) {
      result.skipped.push({ userId, why: check.problem });
    } else if (await moderation.store.openCase(guildId, userId, 'ban')) {
      result.skipped.push({ userId, why: 'banned' });
    } else {
      try {
        const acted = await moderation.act({
          guildId,
          action: 'ban',
          userId,
          moderatorId,
          reason: input.reason,
          deleteMessageSeconds: input.deleteMessageSeconds,
          source: input.source,
          meta: { massban: input.batch },
          quiet: true,
        });
        result.banned.push({ userId, number: acted.row.number });
      } catch (error) {
        result.failed.push(userId);
        log.warn(
          {
            err: error instanceof ActionError ? error.original : error,
            guild: guildId,
            module: 'moderation',
          },
          'mass ban entry failed',
        );
      }
    }
    done += 1;
    await progress?.(done, result.total);
  }

  if (input.shield && result.banned.length > 0) {
    const shield = new ShieldStore(sql);
    for (const entry of result.banned) {
      await shield.report(guildId, entry.userId, 'manual', moderatorId).catch(() => false);
    }
  }
  if (input.summary !== false) await postMassBanSummary(moderation, input, result);
  return result;
}

export function caseRange(result: Pick<MassBanResult, 'banned'>): string | null {
  const numbers = result.banned.map((entry) => entry.number);
  if (numbers.length === 0) return null;
  return copy.massban.cases(Math.min(...numbers), Math.max(...numbers));
}

export function massBanEmbed(
  input: Pick<MassBanInput, 'moderatorId' | 'reason'>,
  result: Pick<MassBanResult, 'total' | 'banned'>,
): Embed {
  const fields: EmbedField[] = [
    { name: copy.fields.moderator, value: moderatorLabel(input.moderatorId, false), inline: true },
  ];
  const range = caseRange(result);
  if (range) fields.push({ name: copy.massban.casesField, value: range, inline: true });
  if (input.reason) fields.push({ name: copy.fields.reason, value: clip(input.reason, 1_000) });
  const members = result.banned.map((entry) => mention.user(entry.userId)).join(' ');
  return {
    color: palette.danger,
    title: copy.massban.logTitle,
    description: clip(
      [copy.massban.logSummary(result.banned.length, result.total), members]
        .filter(Boolean)
        .join('\n'),
      4_000,
    ),
    fields,
    timestamp: new Date(),
  };
}

export async function postMassBanSummary(
  moderation: ModerationService,
  input: Pick<MassBanInput, 'guildId' | 'moderatorId' | 'reason'>,
  result: Pick<MassBanResult, 'total' | 'banned'>,
): Promise<void> {
  if (result.banned.length === 0) return;
  const { platform, log } = moderation.services;
  const channelId = await moderation.logChannel(input.guildId);
  if (!channelId) return;
  await platform
    .send(channelId, { embeds: [massBanEmbed(input, result)], silent: true })
    .catch((error) =>
      log.warn({ err: error, guild: input.guildId, module: 'moderation' }, 'mod log unusable'),
    );
}
