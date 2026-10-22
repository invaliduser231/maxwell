import type { Ticket } from '@maxwell/core/stores/tickets';
import type { Command, GuildContext } from '../../commands/types.js';
import { findPanel, panelTarget } from './config.js';
import { ticketsCopy as copy } from './copy.js';
import { type Modmail, PIN_MS } from './modmail.js';
import { cleanChannelName } from './naming.js';
import type { TicketService } from './service.js';

const NOISE = 8_000;

export function ticketCommands(service: TicketService, mail: Modmail): Command {
  async function current(ctx: GuildContext): Promise<Ticket | null> {
    const ticket = await service.ticketForChannel(ctx.message.channelId);
    if (ticket && ticket.status === 'open' && ticket.guildId === ctx.guildId) return ticket;
    await ctx.reply({ content: copy.notTicket, deleteAfter: NOISE });
    return null;
  }

  async function team(ctx: GuildContext, ticket: Ticket): Promise<boolean> {
    if (await service.isTeam(ctx.guildId, ctx.message.author.id, ticket.panelId)) return true;
    await ctx.reply(`${ctx.services.voice.icon('lock')}${copy.teamOnly}`);
    return false;
  }

  const open: Command = {
    name: 'open',
    description: copy.commands.open,
    guildOnly: true,
    cooldown: 10_000,
    args: [{ name: 'subject', type: 'text', optional: true }],
    examples: ['ticket open', 'ticket open report someone keeps spamming #general'],
    async run(ctx) {
      const { voice } = ctx.services;
      const config = await service.ctx.config(ctx.guildId);
      const fallback = config.panels[0];
      if (!fallback) {
        await ctx.reply(copy.notSetUp);
        return;
      }
      const text = ctx.args.string('subject')?.trim() ?? '';
      const [word = '', ...rest] = text.split(/\s+/);
      const named = findPanel(config, word);
      const panel = named ?? fallback;
      const subject = (named ? rest.join(' ') : text) || null;

      const result = await service.open({
        guildId: ctx.guildId,
        target: panelTarget(panel),
        opener: ctx.message.author,
        source: 'command',
        subject,
      });
      if (result.ok) {
        if (result.ticket.channelId) {
          await ctx.reply(voice.done(copy.opened(result.ticket.channelId), ctx.seed));
        }
        return;
      }
      if (result.reason === 'limit') {
        await ctx.reply(copy.alreadyOpen(result.existing.channelId));
        return;
      }
      if (result.reason === 'permissions') {
        await ctx.reply(voice.botMissingPermissions(result.missing, copy.inCommunity));
        return;
      }
      await ctx.reply(`${voice.icon('no')}${copy.openFailed}`);
    },
  };

  const close: Command = {
    name: 'close',
    description: copy.commands.close,
    guildOnly: true,
    args: [{ name: 'reason', type: 'text', optional: true }],
    examples: ['ticket close', 'ticket close sorted in DMs'],
    async run(ctx) {
      const ticket = await current(ctx);
      if (!ticket) return;
      if (!(await service.canClose(ticket, ctx.message.author.id))) {
        await ctx.reply(`${ctx.services.voice.icon('lock')}${copy.closeNotAllowed}`);
        return;
      }
      const reason = ctx.args.string('reason')?.trim() || null;
      await service.close(ticket, { id: ctx.message.author.id }, reason);
    },
  };

  const claim: Command = {
    name: 'claim',
    description: copy.commands.claim,
    guildOnly: true,
    examples: ['ticket claim'],
    async run(ctx) {
      const ticket = await current(ctx);
      if (!ticket || !(await team(ctx, ticket))) return;
      const self = ctx.message.author.id;
      const next = ticket.claimedBy === self ? null : self;
      await service.claim(ticket, next, { id: self });
    },
  };

  const add: Command = {
    name: 'add',
    description: copy.commands.add,
    guildOnly: true,
    botPermissions: ['ManageRoles'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['ticket add @Lena'],
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const ticket = await current(ctx);
      if (!ticket || !(await team(ctx, ticket))) return;
      const userId = ctx.args.string('member') ?? '';
      if (userId === ticket.openerId || ticket.members.includes(userId)) {
        await ctx.reply({ content: copy.alreadyAdded(userId), deleteAfter: NOISE });
        return;
      }
      if (!(await platform.member(ctx.guildId, userId))) {
        await ctx.reply({ content: copy.notMember, deleteAfter: NOISE });
        return;
      }
      await service.addMember(ticket, userId, { id: ctx.message.author.id });
      await ctx.reply(voice.done(copy.added(userId), ctx.seed));
    },
  };

  const remove: Command = {
    name: 'remove',
    description: copy.commands.remove,
    guildOnly: true,
    botPermissions: ['ManageRoles'],
    args: [{ name: 'member', type: 'user' }],
    examples: ['ticket remove @Lena'],
    async run(ctx) {
      const { voice } = ctx.services;
      const ticket = await current(ctx);
      if (!ticket || !(await team(ctx, ticket))) return;
      const userId = ctx.args.string('member') ?? '';
      if (userId === ticket.openerId) {
        await ctx.reply({ content: copy.keepOpener, deleteAfter: NOISE });
        return;
      }
      if (!ticket.members.includes(userId)) {
        await ctx.reply({ content: copy.notAdded(userId), deleteAfter: NOISE });
        return;
      }
      await service.removeMember(ticket, userId, { id: ctx.message.author.id });
      await ctx.reply(voice.done(copy.removed(userId), ctx.seed));
    },
  };

  const rename: Command = {
    name: 'rename',
    description: copy.commands.rename,
    guildOnly: true,
    botPermissions: ['ManageChannels'],
    args: [{ name: 'name', type: 'text' }],
    examples: ['ticket rename refund-lena'],
    async run(ctx) {
      const { voice } = ctx.services;
      const ticket = await current(ctx);
      if (!ticket || !(await team(ctx, ticket))) return;
      const name = cleanChannelName(ctx.args.string('name') ?? '');
      if (!name) {
        await ctx.reply({ content: copy.badName, deleteAfter: 30_000 });
        return;
      }
      await service.rename(ticket, name, { id: ctx.message.author.id });
      await ctx.reply(voice.done(copy.renamed(name), ctx.seed));
    },
  };

  const modmail: Command = {
    name: 'modmail',
    description: copy.commands.modmail,
    guildOnly: true,
    cooldown: 30_000,
    examples: ['ticket modmail'],
    async run(ctx) {
      const { voice, platform } = ctx.services;
      const config = await service.ctx.config(ctx.guildId);
      if (!config.modmail.enabled) {
        await ctx.reply({ content: copy.modmailOff, deleteAfter: NOISE });
        return;
      }
      const userId = ctx.message.author.id;
      const open = await service.store.openModmail(userId);
      if (open.some((ticket) => ticket.guildId === ctx.guildId)) {
        await ctx.reply({ content: copy.modmailOpenHere, deleteAfter: NOISE });
        return;
      }
      await service.store.pinModmailTarget(userId, ctx.guildId, new Date(Date.now() + PIN_MS));
      mail.forget(userId);
      const guild = await platform.guild(ctx.guildId);
      const sent = await platform.sendDirect(
        userId,
        copy.modmailReady(guild?.name ?? copy.communityFallback),
      );
      if (!sent) {
        await ctx.reply(`${voice.icon('no')}${copy.modmailDmsClosed}`);
        return;
      }
      await ctx.reply({ content: voice.done(copy.modmailCheckDms, ctx.seed), deleteAfter: NOISE });
    },
  };

  return {
    name: 'ticket',
    description: copy.commands.ticket,
    guildOnly: true,
    subcommands: [open, close, claim, add, remove, rename, modmail],
  };
}
