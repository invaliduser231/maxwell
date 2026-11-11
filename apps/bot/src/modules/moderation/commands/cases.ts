import type { CaseRow } from '@maxwell/core/stores/moderation';
import { warnExpiresAt } from '@maxwell/core/stores/moderation';
import { mention } from '../../../commands/mentions.js';
import type { Command, GuildCommand } from '../../../commands/types.js';
import type { Embed } from '../../../platform/types.js';
import { code, lines, snowflakeDate, subtext, timestamp } from '../../../ui/format.js';
import { chunk } from '../../../ui/paginator.js';
import { palette } from '../../../ui/palette.js';
import { authorize, isModerator, modRoleAllow } from '../access.js';
import { NAME_RISK_DAYS } from '../config.js';
import { copy, reasons } from '../copy.js';
import { caseEmbed, moderatorLabel } from '../embeds.js';
import { riskHints } from '../risk.js';
import type { ModerationService } from '../service.js';
import { clip } from '../text.js';
import { noise, who } from './shared.js';

const PAGE_SIZE = 10;
const VIEW: ['ModerateMembers'] = ['ModerateMembers'];

function caseLine(row: CaseRow, withUser: boolean): string {
  const title = row.voidedAt
    ? `~~${copy.actions[row.action]}~~`
    : `**${copy.actions[row.action]}**`;
  const target = withUser && row.userId ? ` ${mention.user(row.userId)}` : '';
  const by = copy.cases.by(moderatorLabel(row.moderatorId, row.meta.external === true));
  const head = `${code(`#${row.number}`)} ${title}${target} ${by} ${timestamp(row.createdAt, 'R')}`;
  return row.reason ? lines(head, subtext(clip(row.reason, 120))) : head;
}

export function caseCommands(moderation: ModerationService): Command[] {
  const { store } = moderation;

  const voidCase: GuildCommand = {
    name: 'void',
    description: copy.commands.caseVoid,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [
      { name: 'case', type: 'integer', min: 1 },
      { name: 'reason', type: 'text', optional: true },
    ],
    examples: ['case void 45 wrong person'],
    async run(ctx) {
      const number = ctx.args.number('case') as number;
      const row = await store.get(ctx.guildId, number);
      if (!row) {
        await noise(ctx, copy.errors.noCase(number));
        return;
      }
      if (row.voidedAt) {
        await noise(ctx, copy.errors.alreadyVoid(number));
        return;
      }
      const reason = ctx.args.string('reason')?.trim() || null;
      const actor = { id: ctx.message.author.id };
      await moderation.voidCase(ctx.guildId, number, actor, reason);
      await moderation.ctx.record(ctx.guildId, actor, 'case.void', reasons.audit.void(number), {
        after: { case: number, reason },
        undo: { kind: 'void', payload: { numbers: [number] } },
      });
      await ctx.reply(ctx.services.voice.done(copy.voided(number), ctx.seed));
    },
  };

  const caseCommand: GuildCommand = {
    name: 'case',
    description: copy.commands.case,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [{ name: 'case', type: 'integer', min: 1 }],
    examples: ['case 42', 'case void 42 wrong person'],
    subcommands: [voidCase],
    async run(ctx) {
      const number = ctx.args.number('case') as number;
      const row = await store.get(ctx.guildId, number);
      if (!row) {
        await noise(ctx, copy.errors.noCase(number));
        return;
      }
      const user = row.userId ? await ctx.platform.user(row.userId) : null;
      await ctx.reply({ embeds: [caseEmbed(row, user, ctx.prefix)] });
    },
  };

  const cases: GuildCommand = {
    name: 'cases',
    aliases: ['history'],
    description: copy.commands.cases,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [
      { name: 'member', type: 'user', optional: true },
      { name: 'page', type: 'integer', min: 1, max: 50, optional: true },
    ],
    examples: ['cases', 'cases @Lena', 'cases 2'],
    async run(ctx) {
      const { platform, voice } = ctx.services;
      const userId = ctx.args.string('member');
      const page = (ctx.args.number('page') ?? 1) - 1;
      const rows = await store.list(ctx.guildId, { userId, limit: 500 });

      if (!userId) {
        if (rows.length === 0) {
          await ctx.reply(voice.empty('moderation.cases', copy.cases.empty, ctx.seed));
          return;
        }
        const pages: Embed[] = chunk(rows, PAGE_SIZE).map((group) => ({
          color: palette.south,
          title: copy.cases.title,
          description: group.map((row) => caseLine(row, true)).join('\n'),
        }));
        await ctx.services.pages.send(ctx, pages, page);
        return;
      }

      const config = await moderation.config(ctx.guildId);
      const [user, member, summary, names, recentNames] = await Promise.all([
        platform.user(userId),
        platform.member(ctx.guildId, userId),
        store.summary(ctx.guildId, userId, config.warnExpiryDays),
        store.nameHistory(ctx.guildId, userId, 5),
        store.nameChanges(ctx.guildId, userId, new Date(Date.now() - NAME_RISK_DAYS * 86_400_000)),
      ]);
      const name = who(user, userId);
      const hints = riskHints({
        accountCreated: snowflakeDate(userId),
        joinedAt: member?.joinedAt ?? null,
        nameChanges: recentNames,
        activeWarns: summary.activeWarns,
        bans: summary.actions.ban ?? 0,
      });
      const earlier = [
        ...new Set(names.map((entry) => entry.previous).filter(Boolean)),
      ] as string[];
      const header = lines(
        copy.cases.summary(summary.total, summary.activeWarns, summary.notes),
        ...hints.map((hint) => `${voice.icon('warn')}${hint}`),
        earlier.length > 0 &&
          subtext(`${copy.cases.names}: ${earlier.map((n) => code(n)).join(', ')}`),
      );

      if (rows.length === 0) {
        await ctx.reply(lines(copy.cases.emptyFor(name), hints.length > 0 && header));
        return;
      }
      const title = copy.cases.titleFor(user?.displayName ?? userId);
      const pages: Embed[] = chunk(rows, PAGE_SIZE).map((group) => ({
        color: palette.south,
        author: user ? { name: title, iconUrl: user.avatarUrl } : undefined,
        title: user ? undefined : title,
        description: lines(header, '', ...group.map((row) => caseLine(row, false))),
        footer: copy.userFooter(userId),
      }));
      await ctx.services.pages.send(ctx, pages, page);
    },
  };

  const reason: GuildCommand = {
    name: 'reason',
    description: copy.commands.reason,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [
      { name: 'case', type: 'integer', min: 1 },
      { name: 'reason', type: 'text' },
    ],
    examples: ['reason 42 raid spam in #general'],
    async run(ctx) {
      const number = ctx.args.number('case') as number;
      const text = clip((ctx.args.string('reason') ?? '').trim(), 1_500);
      const changed = await store.setReason(ctx.guildId, number, text, ctx.message.author.id);
      if (!changed) {
        await noise(ctx, copy.errors.noCase(number));
        return;
      }
      await moderation.ctx.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        'case.reason',
        reasons.audit.reason(number),
        {
          before: { reason: changed.before },
          after: { reason: text },
          undo: {
            kind: 'reason',
            payload: { number, reason: changed.before, unclaim: changed.claimed },
          },
        },
      );
      await moderation.refreshLog(ctx.guildId, number);
      await ctx.reply(ctx.services.voice.done(copy.reason.set(number), ctx.seed));
    },
  };

  const clear: GuildCommand = {
    name: 'clear',
    description: copy.commands.warningsClear,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [
      { name: 'member', type: 'user' },
      { name: 'reason', type: 'text', optional: true },
    ],
    examples: ['warnings clear @Lena appeal accepted'],
    async run(ctx) {
      const userId = ctx.args.string('member') as string;
      const config = await moderation.config(ctx.guildId);
      const user = await ctx.platform.user(userId);
      const name = who(user, userId);
      const active = await store.activeWarns(ctx.guildId, userId, config.warnExpiryDays);
      if (active.length === 0) {
        await ctx.reply(copy.warnings.empty(name));
        return;
      }
      const reasonText = ctx.args.string('reason')?.trim() || null;
      const numbers = await store.voidMany(
        ctx.guildId,
        active.map((row) => row.number),
        ctx.message.author.id,
        reasonText,
      );
      for (const number of numbers) await moderation.refreshLog(ctx.guildId, number);
      await moderation.ctx.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        'case.clear',
        reasons.audit.clear(numbers.length, user ? `@${user.username}` : userId),
        {
          after: { cases: numbers, reason: reasonText },
          undo: { kind: 'void', payload: { numbers } },
        },
      );
      await ctx.reply(
        lines(
          `${ctx.services.voice.icon('ok')}${copy.warnings.cleared(numbers.length, name)}`,
          subtext(copy.warnings.undoHint),
        ),
      );
    },
  };

  const warnings: GuildCommand = {
    name: 'warnings',
    aliases: ['warns'],
    description: copy.commands.warnings,
    guildOnly: true,
    args: [{ name: 'member', type: 'user', optional: true }],
    examples: ['warnings', 'warnings @Lena', 'warnings clear @Lena'],
    subcommands: [clear],
    async run(ctx) {
      const self = ctx.message.author.id;
      const userId = ctx.args.string('member') ?? self;
      if (userId !== self && !(await authorize(ctx, VIEW))) return;
      const config = await moderation.config(ctx.guildId);
      const user = await ctx.platform.user(userId);
      const name = who(user, userId);
      const active = await store.activeWarns(ctx.guildId, userId, config.warnExpiryDays);
      if (active.length === 0) {
        await ctx.reply(copy.warnings.empty(name));
        return;
      }
      const showModerator = userId !== self || (await isModerator(ctx, VIEW));
      const entries = active.map((row) => {
        const expires = warnExpiresAt(row.createdAt, config.warnExpiryDays);
        const head = `${code(`#${row.number}`)} ${timestamp(row.createdAt, 'R')}${
          showModerator ? ` ${copy.cases.by(moderatorLabel(row.moderatorId, false))}` : ''
        }`;
        return lines(
          head,
          row.reason ? clip(row.reason, 200) : null,
          expires && subtext(copy.warnings.expires(timestamp(expires, 'R'))),
        );
      });
      const pages: Embed[] = chunk(entries, PAGE_SIZE).map((group) => ({
        color: palette.warning,
        title: copy.warnings.title(user?.displayName ?? userId),
        description: group.join('\n'),
      }));
      await ctx.services.pages.send(ctx, pages);
    },
  };

  return [caseCommand, cases, reason, warnings];
}
