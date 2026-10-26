import { type Actor, maxwell } from '@maxwell/core';
import definition from '@maxwell/core/modules/tickets';
import { inGuild } from '../../i18n/language.js';
import { defineBotModule } from '../../runtime/module.js';
import { formInboxFor } from '../forms/inbox.js';
import { verifyInboxFor } from '../security/verification.js';
import { ticketCommands } from './commands.js';
import { MODULE } from './config.js';
import { ticketsCopy as copy, ticketsAudit } from './copy.js';
import { Modmail } from './modmail.js';
import { Panels } from './panels.js';
import { ticketPrivacy } from './privacy.js';
import { Ratings } from './rating.js';
import { TicketService } from './service.js';

const SWEEP_MS = 15 * 60_000;
const SWEEP_KEY = `${MODULE}.sweep`;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function actorOf(payload: Record<string, unknown>): Actor {
  return { id: text(payload.by) ?? text(payload.actorId) };
}

export default defineBotModule({
  definition,
  setup(ctx) {
    const { services } = ctx;
    const { platform, log } = services;
    const service = new TicketService(ctx);
    const panels = new Panels(service);
    const ratings = new Ratings(service);
    const modmail = new Modmail(service);
    const inbox = formInboxFor(services);
    const verifyInbox = verifyInboxFor(services);
    ctx.privacy(ticketPrivacy(service));

    ctx.on('message', async (message) => {
      if (message.guildId) {
        await service.onGuildMessage(message);
        return;
      }
      if (message.author.bot || message.fromWebhook) return;
      if (inbox.hasUser(message.author.id)) return;
      if (verifyInbox.has(message.author.id)) return;
      await service.store.rememberDm(message.author.id, message.channelId);
      const prefix = await services.guilds.prefix(null);
      if (message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;
      if (!modmail.picking(message.author.id) && (await ratings.onText(message))) return;
      await modmail.handle(message);
    });
    ctx.on('messageEdit', (edit) => service.onEdit(edit));
    ctx.on('messageRemove', (removal) => service.onRemove(removal));
    ctx.on('channelDelete', ({ channel }) => service.onChannelGone(channel.id), { always: true });
    ctx.on('reaction', async (reaction) => {
      if (reaction.bot || reaction.userId === platform.selfId) return;
      if (!reaction.guildId) {
        if (await modmail.onPage(reaction)) return;
        await ratings.onReaction(reaction);
        return;
      }
      if (await service.onControlReaction(reaction)) return;
      await panels.onReaction(reaction);
    });
    ctx.on('reactionRemove', async (reaction) => {
      if (reaction.guildId || reaction.bot || reaction.userId === platform.selfId) return;
      await modmail.onPage(reaction);
    });

    ctx.job('panel.publish', async (job) => {
      const panelId = text(job.payload.panelId);
      if (!job.guildId || !panelId) return;
      const outcome = await panels.publish(job.guildId, panelId, actorOf(job.payload));
      if (outcome !== 'posted' && outcome !== 'updated') {
        log.warn({ guild: job.guildId, panel: panelId, outcome }, 'ticket panel not published');
      }
    });

    ctx.job('panel.remove', async (job) => {
      const panelId = text(job.payload.panelId);
      if (!job.guildId || !panelId) return;
      if (await panels.unpublish(job.guildId, panelId)) {
        const config = await ctx.config(job.guildId);
        const name = config.panels.find((panel) => panel.id === panelId)?.name ?? panelId;
        await ctx.record(
          job.guildId,
          actorOf(job.payload),
          'panel.remove',
          ticketsAudit.auditUnpublish(name),
        );
      }
    });

    ctx.job('close', async (job) => {
      const ticketId = text(job.payload.ticketId);
      if (!job.guildId || !ticketId) return;
      const ticket = await service.store.getInGuild(job.guildId, ticketId);
      if (ticket?.status !== 'open') return;
      await service.close(ticket, actorOf(job.payload), text(job.payload.reason));
    });

    ctx.job('claim', async (job) => {
      const ticketId = text(job.payload.ticketId);
      if (!job.guildId || !ticketId) return;
      const ticket = await service.store.getInGuild(job.guildId, ticketId);
      if (ticket?.status !== 'open') return;
      const actor = actorOf(job.payload);
      const userId = job.payload.userId === null ? null : (text(job.payload.userId) ?? actor.id);
      if (userId === ticket.claimedBy) return;
      await service.claim(ticket, userId, actor);
    });

    ctx.job('member.add', async (job) => {
      const ticketId = text(job.payload.ticketId);
      const userId = text(job.payload.userId);
      if (!job.guildId || !ticketId || !userId) return;
      const ticket = await service.store.getInGuild(job.guildId, ticketId);
      if (ticket?.status !== 'open' || !ticket.channelId) return;
      if (userId === ticket.openerId || ticket.members.includes(userId)) return;
      if (!(await platform.member(job.guildId, userId))) return;
      if (!(await service.addMember(ticket, userId, actorOf(job.payload)))) return;
      const notice = copy.added(userId);
      const messageId = await platform.send(ticket.channelId, notice).catch(() => null);
      if (messageId) await service.recordOwn(ticket, messageId, notice);
    });

    ctx.job('reply', async (job) => {
      const ticketId = text(job.payload.ticketId);
      const content = text(job.payload.content);
      const staffId = actorOf(job.payload).id;
      if (!job.guildId || !ticketId || !content || !staffId) return;
      const ticket = await service.store.getInGuild(job.guildId, ticketId);
      if (ticket?.status !== 'open') return;
      await service.staffReply(ticket, staffId, content);
    });

    ctx.job('reopen', async (job) => {
      const ticketId = text(job.payload.ticketId);
      if (!job.guildId || !ticketId) return;
      const ticket = await service.store.getInGuild(job.guildId, ticketId);
      if (!ticket) return;
      const actor = actorOf(job.payload);
      const reopened = await service.reopen(ticket.id, actor);
      if (reopened) {
        await ctx.record(
          job.guildId,
          actor,
          'ticket.reopen',
          ticketsAudit.auditReopen(reopened.number),
          {
            undo: { kind: 'reopen', payload: { ticketId: reopened.id } },
          },
        );
      }
    });

    ctx.job('finish', async (job) => {
      const ticketId = text(job.payload.ticketId);
      if (!ticketId) return;
      await service.finish(ticketId, (ticket, guild) => ratings.request(ticket, guild));
    });

    ctx.job('sweep', async () => {
      try {
        for (const ticket of await service.store.autoCloseDue()) {
          await inGuild(ticket.guildId, () =>
            service.close(ticket, maxwell, null, { idle: true }),
          ).catch((error) => log.warn({ err: error, ticket: ticket.id }, 'auto close failed'));
        }
      } finally {
        await ctx.schedule('sweep', {
          runAt: new Date(Date.now() + SWEEP_MS),
          dedupeKey: SWEEP_KEY,
        });
      }
    });
    ctx.on('ready', () => ctx.schedule('sweep', { dedupeKey: SWEEP_KEY }).then(() => undefined), {
      always: true,
    });

    ctx.undo('close', async (entry, payload, by) => {
      const ticketId = text(payload.ticketId);
      if (!ticketId) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (ticket) await service.reopen(ticket.id, by);
    });

    ctx.undo('reopen', async (entry, payload, by) => {
      const ticketId = text(payload.ticketId);
      if (!ticketId) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (ticket?.status === 'open') await service.close(ticket, by, null);
    });

    ctx.undo('claim', async (entry, payload) => {
      const ticketId = text(payload.ticketId);
      if (!ticketId) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (!ticket) return;
      await service.store.claim(ticket.id, text(payload.userId));
      if (ticket.channelId) service.forget(ticket.channelId);
    });

    ctx.undo('member.add', async (entry, payload) => {
      const ticketId = text(payload.ticketId);
      const userId = text(payload.userId);
      if (!ticketId || !userId) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (ticket) await service.removeMember(ticket, userId, null);
    });

    ctx.undo('member.remove', async (entry, payload) => {
      const ticketId = text(payload.ticketId);
      const userId = text(payload.userId);
      if (!ticketId || !userId) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (ticket) await service.addMember(ticket, userId, null);
    });

    ctx.undo('rename', async (entry, payload) => {
      const ticketId = text(payload.ticketId);
      const name = text(payload.name);
      if (!ticketId || !name) return;
      const ticket = await service.store.getInGuild(entry.guildId, ticketId);
      if (ticket) await service.rename(ticket, name, null);
    });

    ctx.undo('panel.publish', async (entry, payload) => {
      const panelId = text(payload.panelId);
      if (!panelId) return;
      await panels.unpublish(entry.guildId, panelId, text(payload.messageId) ?? undefined);
    });

    return [ticketCommands(service, modmail)];
  },
});
