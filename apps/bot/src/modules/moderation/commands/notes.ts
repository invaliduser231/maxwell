import { mention } from '../../../commands/mentions.js';
import type { Command, GuildCommand } from '../../../commands/types.js';
import type { Embed } from '../../../platform/types.js';
import { lines, timestamp } from '../../../ui/format.js';
import { chunk } from '../../../ui/paginator.js';
import { palette } from '../../../ui/palette.js';
import { modRoleAllow } from '../access.js';
import { copy, reasons } from '../copy.js';
import type { ModerationService } from '../service.js';
import { clip } from '../text.js';
import { NOISE_TTL, noise, who } from './shared.js';

const VIEW: ['ModerateMembers'] = ['ModerateMembers'];
const PRIVATE_TTL = 60_000;

export function noteCommands(moderation: ModerationService): Command[] {
  const { store } = moderation;

  const remove: GuildCommand = {
    name: 'remove',
    description: copy.commands.noteRemove,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [{ name: 'number', type: 'integer', min: 1 }],
    examples: ['note remove 12'],
    async run(ctx) {
      const number = ctx.args.number('number') ?? 0;
      const found = await store.noteByNumber(ctx.guildId, number);
      if (!found || !(await store.deleteNote(ctx.guildId, found.id))) {
        await noise(ctx, copy.errors.noNote(number));
        return;
      }
      const id = found.id;
      await moderation.ctx.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        'note.remove',
        reasons.audit.noteRemoved(number),
        { after: { note: id, number }, undo: { kind: 'note.restore', payload: { id } } },
      );
      await ctx.reply({
        content: ctx.services.voice.done(copy.notes.removed(number), ctx.seed),
        deleteAfter: NOISE_TTL,
      });
    },
  };

  const note: GuildCommand = {
    name: 'note',
    description: copy.commands.note,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [
      { name: 'member', type: 'user' },
      { name: 'note', type: 'text' },
    ],
    examples: ['note @Lena asked about the rules twice', 'note remove 12'],
    subcommands: [remove],
    async run(ctx) {
      const userId = ctx.args.string('member') as string;
      const body = clip((ctx.args.string('note') ?? '').trim(), 1_000);
      const user = await ctx.platform.user(userId);
      const row = await store.addNote(ctx.guildId, userId, ctx.message.author.id, body);
      await moderation.ctx.record(
        ctx.guildId,
        { id: ctx.message.author.id },
        'note.add',
        reasons.audit.note(user ? `@${user.username}` : userId),
        {
          after: { note: row.id, number: row.number, userId },
          undo: { kind: 'note', payload: { id: row.id } },
        },
      );
      await ctx.platform.delete(ctx.message.channelId, ctx.message.id).catch(() => {});
      await ctx.platform.send(ctx.message.channelId, {
        content: ctx.services.voice.done(copy.notes.added(who(user, userId)), ctx.seed),
        deleteAfter: NOISE_TTL,
      });
    },
  };

  const notes: GuildCommand = {
    name: 'notes',
    description: copy.commands.notes,
    guildOnly: true,
    permissions: VIEW,
    allow: modRoleAllow,
    args: [{ name: 'member', type: 'user' }],
    examples: ['notes @Lena'],
    async run(ctx) {
      const userId = ctx.args.string('member') as string;
      const user = await ctx.platform.user(userId);
      const name = who(user, userId);
      const rows = await store.notes(ctx.guildId, userId, 100);
      if (rows.length === 0) {
        await ctx.reply({ content: copy.notes.empty(name), deleteAfter: NOISE_TTL });
        return;
      }
      const entries = rows.map((row) =>
        lines(
          copy.notes.line(
            row.number,
            timestamp(row.createdAt, 'R'),
            row.authorId ? copy.cases.by(mention.user(row.authorId)) : '',
          ),
          row.body,
        ),
      );
      const title = copy.notes.title(user?.displayName ?? userId);
      const embeds: Embed[] = chunk(entries, 8)
        .slice(0, 10)
        .map((group) => ({
          color: palette.muted,
          title,
          description: clip(group.join('\n\n'), 4_000),
        }));
      const sent = await ctx.platform
        .sendDirect(ctx.message.author.id, { embeds })
        .catch(() => false);
      if (sent) {
        await ctx.reply({ content: copy.notes.sent, deleteAfter: NOISE_TTL });
        return;
      }
      await ctx.reply({ embeds: embeds.slice(0, 1), deleteAfter: PRIVATE_TTL });
    },
  };

  return [note, notes];
}
