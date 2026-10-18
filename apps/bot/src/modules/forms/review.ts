import { type Actor, maxwell } from '@maxwell/core';
import type { FormDefinition, formsConfig } from '@maxwell/core/modules/forms';
import type {
  AppliedActions,
  FormStore,
  FormSubmission,
  FormVote,
} from '@maxwell/core/stores/forms';
import { mention } from '../../commands/mentions.js';
import type { ReactionEvent } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { BoundedCache } from '../tickets/cache.js';
import { panelTarget } from '../tickets/config.js';
import { displayEmoji, fallbackEmoji, iconReaction, sameEmoji } from '../tickets/emoji.js';
import { fillTemplate } from '../tickets/naming.js';
import { ticketServiceFor } from '../tickets/service.js';
import { audit, formsCopy as copy } from './copy.js';
import { answersText, reviewEmbed } from './render.js';

export type FormsContext = ModuleContext<typeof formsConfig>;
export type Decision = 'accept' | 'decline';
export type DecideOutcome = 'done' | 'missing' | 'already';

export class Reviews {
  readonly #byMessage = new BoundedCache<string, string | null>(5_000, 10 * 60_000);

  constructor(
    private readonly ctx: FormsContext,
    private readonly store: FormStore,
  ) {}

  acceptEmoji(): string {
    return iconReaction(this.ctx.services.voice.icons, 'ok', fallbackEmoji.accept);
  }

  declineEmoji(): string {
    return iconReaction(this.ctx.services.voice.icons, 'no', fallbackEmoji.decline);
  }

  async #render(submission: FormSubmission) {
    const [user, tally] = await Promise.all([
      this.ctx.services.platform.user(submission.userId),
      this.store.tally(submission.id),
    ]);
    return reviewEmbed(submission, user, {
      tally,
      accept: displayEmoji(this.acceptEmoji()),
      decline: displayEmoji(this.declineEmoji()),
    });
  }

  async post(submission: FormSubmission, form: FormDefinition): Promise<void> {
    const { platform, log } = this.ctx.services;
    const channelId = form.reviewChannelId;
    if (!channelId) return;
    if (!(await platform.channelInGuild(submission.guildId, channelId).catch(() => false))) {
      log.info({ guild: submission.guildId, form: form.id }, 'form review channel missing');
      return;
    }
    const missing = await platform
      .missingBotPermissions(submission.guildId, channelId, ['SendMessages', 'EmbedLinks'])
      .catch(() => ['SendMessages']);
    if (missing.length) {
      log.info({ guild: submission.guildId, missing }, 'form review channel not usable');
      return;
    }
    const messageId = await platform.send(channelId, {
      embeds: [await this.#render(submission)],
      silent: true,
    });
    await this.store.setReviewMessage(submission.id, channelId, messageId);
    this.#byMessage.set(messageId, submission.id);
    for (const emoji of [this.acceptEmoji(), this.declineEmoji()]) {
      await platform.react(channelId, messageId, emoji).catch(() => {});
    }
  }

  async refresh(submission: FormSubmission): Promise<void> {
    if (!submission.reviewChannelId || !submission.reviewMessageId) return;
    await this.ctx.services.platform
      .edit(submission.reviewChannelId, submission.reviewMessageId, {
        embeds: [await this.#render(submission)],
      })
      .catch((error) =>
        this.ctx.services.log.info(
          { err: error, submission: submission.id },
          'form review message not editable',
        ),
      );
  }

  async #lookup(messageId: string): Promise<FormSubmission | null> {
    const hit = this.#byMessage.peek(messageId);
    if (hit && hit.value === null) return null;
    const submission = await this.store.byReviewMessage(messageId);
    this.#byMessage.set(messageId, submission?.id ?? null);
    return submission;
  }

  #voteFor(emoji: string): FormVote | null {
    if (sameEmoji(emoji, this.acceptEmoji())) return 'accept';
    if (sameEmoji(emoji, this.declineEmoji())) return 'decline';
    return null;
  }

  async isReviewer(guildId: string, userId: string, form: FormDefinition | null) {
    const { platform } = this.ctx.services;
    const roles = form?.reviewerRoleIds ?? [];
    if (roles.length) {
      const member = await platform.member(guildId, userId);
      if (member?.roles.some((role) => roles.includes(role))) return true;
    }
    return platform.hasPermissions(guildId, userId, null, ['ManageGuild']).catch(() => false);
  }

  async onReaction(reaction: ReactionEvent, added: boolean): Promise<void> {
    if (!reaction.guildId || reaction.bot) return;
    if (reaction.userId === this.ctx.services.platform.selfId) return;
    const vote = this.#voteFor(reaction.emoji);
    if (!vote) return;
    const submission = await this.#lookup(reaction.messageId);
    if (!submission || submission.guildId !== reaction.guildId) return;
    const { platform } = this.ctx.services;

    if (!added) {
      if (submission.status !== 'pending') return;
      if (await this.store.unvote(submission.id, reaction.userId, vote)) {
        await this.refresh(submission);
      }
      return;
    }

    const config = await this.ctx.config(submission.guildId);
    const form = config.forms.find((candidate) => candidate.id === submission.formId) ?? null;
    const allowed =
      submission.status === 'pending' &&
      reaction.userId !== submission.userId &&
      (await this.isReviewer(submission.guildId, reaction.userId, form));
    if (!allowed) {
      await platform
        .unreact(reaction.channelId, reaction.messageId, reaction.emoji, reaction.userId)
        .catch(() => {});
      return;
    }

    await this.store.vote(submission.id, reaction.userId, vote);
    const other = vote === 'accept' ? this.declineEmoji() : this.acceptEmoji();
    await platform
      .unreact(reaction.channelId, reaction.messageId, other, reaction.userId)
      .catch(() => {});

    const tally = await this.store.tally(submission.id);
    if (form?.votesToAccept && tally.accept >= form.votesToAccept) {
      await this.decide(submission.guildId, submission.id, 'accept', maxwell, null);
      return;
    }
    if (form?.votesToDecline && tally.decline >= form.votesToDecline) {
      await this.decide(submission.guildId, submission.id, 'decline', maxwell, null);
      return;
    }
    await this.refresh(submission);
  }

  async decide(
    guildId: string,
    submissionId: string,
    decision: Decision,
    actor: Actor,
    note: string | null,
  ): Promise<DecideOutcome> {
    const existing = await this.store.submissionInGuild(guildId, submissionId);
    if (!existing) return 'missing';
    const status = decision === 'accept' ? 'accepted' : 'declined';
    const decided = await this.store.decide(existing.id, status, actor.id, note);
    if (!decided) return 'already';

    const config = await this.ctx.config(guildId);
    const form = config.forms.find((candidate) => candidate.id === decided.formId) ?? null;
    const applied = form
      ? await this.#apply(decided, form, decision, note)
      : { addedRoleIds: [], removedRoleIds: [], ticketId: null, dmSent: false };
    await this.store.setApplied(decided.id, applied);
    await this.refresh(decided);

    await this.ctx.record(
      guildId,
      actor,
      `submission.${decision}`,
      decision === 'accept' ? audit.accept(decided.formName) : audit.decline(decided.formName),
      {
        before: { status: 'pending' },
        after: { status, number: decided.number, note, applied },
        undo: { kind: 'decision', payload: { submissionId: decided.id } },
      },
    );
    return 'done';
  }

  async #apply(
    submission: FormSubmission,
    form: FormDefinition,
    decision: Decision,
    note: string | null,
  ): Promise<AppliedActions> {
    const { platform, log } = this.ctx.services;
    const action = decision === 'accept' ? form.onAccept : form.onDecline;
    const applied: AppliedActions = {
      addedRoleIds: [],
      removedRoleIds: [],
      ticketId: null,
      dmSent: false,
    };
    const { guildId, userId } = submission;
    const reason = `${form.name} ${decision === 'accept' ? 'accepted' : 'declined'}`;

    const member = await platform.member(guildId, userId);
    if (member) {
      for (const roleId of action.addRoleIds) {
        if (member.roles.includes(roleId)) continue;
        try {
          await platform.addRole(guildId, userId, roleId, reason);
          applied.addedRoleIds.push(roleId);
        } catch (error) {
          log.warn({ err: error, guild: guildId, role: roleId }, 'form role add failed');
        }
      }
      for (const roleId of action.removeRoleIds) {
        if (!member.roles.includes(roleId)) continue;
        try {
          await platform.removeRole(guildId, userId, roleId, reason);
          applied.removedRoleIds.push(roleId);
        } catch (error) {
          log.warn({ err: error, guild: guildId, role: roleId }, 'form role remove failed');
        }
      }
    }

    if (action.openTicket && member) {
      applied.ticketId = await this.#openTicket(submission, form, action.ticketPanelId).catch(
        (error) => {
          log.warn({ err: error, guild: guildId }, 'form ticket failed');
          return null;
        },
      );
    }

    const guild = await platform.guild(guildId);
    const guildName = guild?.name ?? '';
    const text = action.dm
      ? fillTemplate(action.dm, {
          user: mention.user(userId),
          form: form.name,
          server: guildName,
          note: note ?? '',
        })
      : decision === 'accept'
        ? copy.dmAccepted(form.name, guildName)
        : copy.dmDeclined(form.name, guildName);
    applied.dmSent = await platform.sendDirect(userId, text);
    return applied;
  }

  async #openTicket(
    submission: FormSubmission,
    form: FormDefinition,
    panelId: string | null,
  ): Promise<string | null> {
    const tickets = ticketServiceFor(this.ctx.services);
    if (!tickets || !(await tickets.ctx.enabled(submission.guildId))) return null;
    const config = await tickets.ctx.config(submission.guildId);
    const panel =
      (panelId ? config.panels.find((candidate) => candidate.id === panelId) : undefined) ??
      config.panels[0];
    const user = await this.ctx.services.platform.user(submission.userId);
    if (!panel || !user) return null;
    const result = await tickets.open({
      guildId: submission.guildId,
      target: panelTarget(panel),
      opener: user,
      source: 'form',
      subject: form.name,
      intro: lines(
        copy.ticketIntro(form.name, submission.userId),
        '',
        answersText(submission.answers, 1_800),
      ),
    });
    if (result.ok) return result.ticket.id;
    return result.reason === 'limit' ? result.existing.id : null;
  }

  async revert(guildId: string, submissionId: string): Promise<boolean> {
    const { platform, log } = this.ctx.services;
    const submission = await this.store.submissionInGuild(guildId, submissionId);
    if (!submission || submission.status === 'pending') return false;
    const applied = submission.applied;
    if (applied) {
      const reason = `${submission.formName} decision undone`;
      for (const roleId of applied.addedRoleIds) {
        await platform
          .removeRole(guildId, submission.userId, roleId, reason)
          .catch((error) => log.warn({ err: error, role: roleId }, 'form role revert failed'));
      }
      for (const roleId of applied.removedRoleIds) {
        await platform
          .addRole(guildId, submission.userId, roleId, reason)
          .catch((error) => log.warn({ err: error, role: roleId }, 'form role revert failed'));
      }
    }
    const reopened = await this.store.reopen(submission.id);
    if (reopened) await this.refresh(reopened);
    return reopened !== null;
  }
}

export function isDecision(value: unknown): value is Decision {
  return value === 'accept' || value === 'decline';
}
