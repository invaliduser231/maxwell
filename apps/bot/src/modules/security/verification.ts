import type { Job } from '@maxwell/core';
import type { SecurityConfig } from '@maxwell/core/modules/security';
import type { CheckStatus, SecurityCheck, SecurityStore } from '@maxwell/core/stores/security';
import { mention } from '../../commands/mentions.js';
import { inGuild } from '../../i18n/language.js';
import type { Embed, MemberJoin, MemberUpdate } from '../../platform/types.js';
import { lines, snowflakeDate, timestamp } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { InboxFeed } from '../moderation/feed.js';
import { matches, normalizeAnswer, renderCaptcha } from './captcha.js';
import { copy, reasons } from './copy.js';
import type { Ctx, Guard } from './guard.js';
import {
  JoinLog,
  type JoinSample,
  type RiskReason,
  scoreMember,
  storedReasons,
  waveAround,
} from './risk.js';

export const WAVE_MIN = 3;
const WAVE_WINDOW = 10 * 60_000;
const CAPTCHA_FILE = 'captcha.png';

export interface RaidProbe {
  active(guildId: string): Promise<boolean>;
}

export class Inbox {
  readonly #users = new Map<string, number>();

  add(userId: string): void {
    this.#users.set(userId, (this.#users.get(userId) ?? 0) + 1);
  }

  remove(userId: string): void {
    const left = (this.#users.get(userId) ?? 0) - 1;
    if (left > 0) this.#users.set(userId, left);
    else this.#users.delete(userId);
  }

  has(userId: string): boolean {
    return this.#users.has(userId);
  }

  load(checks: readonly SecurityCheck[]): void {
    this.#users.clear();
    for (const check of checks) this.add(check.userId);
  }
}

const inboxes = new WeakMap<object, Inbox>();

export function verifyInboxFor(owner: object): Inbox {
  let inbox = inboxes.get(owner);
  if (!inbox) {
    inbox = new Inbox();
    inboxes.set(owner, inbox);
  }
  return inbox;
}

export type Outcome = 'clear' | 'pending' | 'severe';

export function decide(
  score: number,
  config: SecurityConfig['verification'],
  raid: boolean,
): Outcome {
  if (config.severeAction !== 'none' && score >= config.severeScore) return 'severe';
  if (raid || score >= config.threshold) return 'pending';
  return 'clear';
}

function statusText(status: CheckStatus): string {
  return copy.log.status[status];
}

export class Verifier {
  readonly joins = new JoinLog();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(
    private readonly ctx: Ctx,
    private readonly store: SecurityStore,
    private readonly guard: Guard,
    private readonly raid: RaidProbe,
    readonly inbox: Inbox,
    private readonly now: () => number = Date.now,
  ) {
    this.feed = new InboxFeed(ctx.services);
  }

  readonly feed: InboxFeed;

  onJoin(join: MemberJoin): Promise<void> {
    const previous = this.#queues.get(join.guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.#join(join))
      .finally(() => {
        if (this.#queues.get(join.guildId) === next) this.#queues.delete(join.guildId);
      });
    this.#queues.set(join.guildId, next);
    return next;
  }

  async #join(join: MemberJoin): Promise<void> {
    if (join.user.bot) return;
    const { guildId, user } = join;
    const config = await this.ctx.config(guildId);
    const settings = config.verification;
    const createdAt = snowflakeDate(user.id);
    const sample: JoinSample = {
      userId: user.id,
      at: this.now(),
      createdAt: createdAt.getTime(),
      name: user.username,
      hasAvatar: user.hasAvatar ?? true,
    };
    const recent = this.joins.add(guildId, sample, WAVE_WINDOW);
    if (!settings.enabled && !config.logChannelId) return;

    const wave = waveAround(recent.slice(0, -1), sample);
    const [history, raid, member] = await Promise.all([
      this.store.history(guildId, user.id).catch(() => ({ kicks: 0, bans: 0, leftAt: null })),
      this.raid.active(guildId),
      this.ctx.services.platform.member(guildId, user.id).catch(() => null),
    ]);
    const result = scoreMember(
      {
        createdAt,
        joinedAt: join.joinedAt,
        hasAvatar: user.hasAvatar ?? true,
        globalName: user.globalName ?? null,
        nick: member?.nick ?? null,
        username: user.username,
        displayName: user.displayName,
        waveSize: wave.length >= WAVE_MIN ? wave.length : 0,
        leftAt: history.leftAt,
        kicks: history.kicks,
        bans: history.bans,
        inviterAgeHours: null,
        raid,
      },
      settings.weights,
      settings.spamWords,
    );

    if (!settings.enabled) {
      await this.#log(
        guildId,
        config,
        user.id,
        user.displayName,
        user.avatarUrl,
        result.score,
        result.reasons,
        'clear',
        null,
      );
      return;
    }

    const outcome = decide(result.score, settings, raid);
    if (outcome === 'clear') {
      const check = await this.store.openCheck({
        guildId,
        userId: user.id,
        score: result.score,
        reasons: result.reasons,
        status: 'clear',
        method: null,
        code: null,
        expiresAt: null,
      });
      await this.#log(
        guildId,
        config,
        user.id,
        user.displayName,
        user.avatarUrl,
        result.score,
        result.reasons,
        'clear',
        check,
      );
      return;
    }

    if (outcome === 'severe') {
      const action = settings.severeAction === 'ban' ? 'ban' : 'kick';
      await this.store.openCheck({
        guildId,
        userId: user.id,
        score: result.score,
        reasons: result.reasons,
        status: 'failed',
        method: 'none',
        code: null,
        expiresAt: null,
      });
      await this.guard.punish(guildId, user.id, action, reasons.severe(result.score));
      await this.store.event({
        guildId,
        kind: 'severe',
        userId: user.id,
        actorId: null,
        summary: `${action} at score ${result.score}`,
        detail: { score: result.score, reasons: result.reasons.map((reason) => reason.key) },
      });
      await this.#log(
        guildId,
        config,
        user.id,
        user.displayName,
        user.avatarUrl,
        result.score,
        result.reasons,
        'failed',
        null,
        copy.log.severe(copy.log.severeActions[action]),
      );
      return;
    }

    await this.#challenge(
      guildId,
      config,
      user.id,
      user.displayName,
      user.avatarUrl,
      result.score,
      result.reasons,
    );
  }

  async #challenge(
    guildId: string,
    config: SecurityConfig,
    userId: string,
    name: string,
    avatarUrl: string | null,
    score: number,
    riskReasons: RiskReason[],
  ): Promise<void> {
    const { platform, guilds } = this.ctx.services;
    const settings = config.verification;
    const held = await this.guard.hold(guildId, userId, 'verify');
    const captcha = await renderCaptcha();
    const expiresAt = new Date(this.now() + settings.minutes * 60_000);
    const check = await this.store.openCheck({
      guildId,
      userId,
      score,
      reasons: riskReasons,
      status: 'pending',
      method: null,
      code: captcha.code,
      expiresAt,
    });
    this.inbox.add(userId);

    const guild = await platform.guild(guildId);
    const guildName = guild?.name ?? '';
    const color = copy.colors[captcha.color];
    const dmPrefix = await guilds.prefix(null);
    const sentDm = await platform.sendDirect(userId, {
      embeds: [
        {
          color: palette.south,
          title: copy.dm.title(guildName),
          description: lines(
            copy.dm.intro(color),
            '',
            copy.dm.expires(timestamp(expiresAt, 'R')),
            copy.dm.how(dmPrefix),
          ),
          imageUrl: `attachment://${CAPTCHA_FILE}`,
        },
      ],
      files: [{ name: CAPTCHA_FILE, data: captcha.png }],
    });

    let method: 'dm' | 'channel' | 'none' = sentDm ? 'dm' : 'none';
    let fallback: string | null = null;
    if (!sentDm) {
      fallback = settings.channelId ?? (await this.guard.gate(guildId)).channelId;
      if (fallback) {
        const prefix = await guilds.prefix(guildId);
        const sent = await platform
          .send(fallback, {
            content: copy.channel.intro(userId, color, prefix),
            mentionUsers: [userId],
            files: [{ name: CAPTCHA_FILE, data: captcha.png }],
            deleteAfter: settings.minutes * 60_000,
          })
          .then(() => true)
          .catch(() => false);
        if (sent) method = 'channel';
      }
    }
    await this.store.setCode(check.id, captcha.code, method);
    if (method === 'none') await this.feed.check(guildId, userId, check.id, 'undelivered');
    await this.ctx.schedule('verify.expire', {
      guildId,
      payload: { checkId: check.id },
      runAt: expiresAt,
      dedupeKey: `security.verify:${check.id}`,
    });

    const note = !held
      ? copy.log.noGate
      : method === 'dm'
        ? copy.log.flaggedDm
        : method === 'channel' && fallback
          ? copy.log.flaggedChannel(fallback)
          : copy.log.flaggedNowhere;
    await this.#log(
      guildId,
      config,
      userId,
      name,
      avatarUrl,
      score,
      riskReasons,
      'pending',
      check,
      note,
    );
  }

  async #log(
    guildId: string,
    config: SecurityConfig,
    userId: string,
    name: string,
    avatarUrl: string | null,
    score: number,
    riskReasons: RiskReason[],
    status: CheckStatus,
    check: SecurityCheck | null,
    note?: string,
  ): Promise<void> {
    if (!config.logChannelId) return;
    const embed = joinEmbed(
      userId,
      name,
      avatarUrl,
      score,
      riskReasons.map(copy.reason),
      status,
      note,
    );
    const posted = await this.guard.post(guildId, config, { embed });
    if (posted && check) await this.store.setLog(check.id, posted.channelId, posted.messageId);
  }

  async #finish(
    check: SecurityCheck,
    status: Exclude<CheckStatus, 'pending' | 'clear'>,
  ): Promise<void> {
    this.inbox.remove(check.userId);
    if (status === 'passed') await this.feed.checkClosed(check.guildId, check.id, 'passed', null);
    if (!check.logChannelId || !check.logMessageId) return;
    const { platform } = this.ctx.services;
    const member = await platform.member(check.guildId, check.userId).catch(() => null);
    const user = member?.user ?? (await platform.user(check.userId));
    const embed = joinEmbed(
      check.userId,
      user?.displayName ?? check.userId,
      user?.avatarUrl ?? null,
      check.score,
      storedReasons(check.reasons).map(copy.reason),
      status,
    );
    await platform
      .edit(check.logChannelId, check.logMessageId, { embeds: [embed] })
      .catch(() => {});
  }

  async answer(
    userId: string,
    text: string,
    guildId: string | null,
    reply: (content: string) => Promise<unknown>,
  ): Promise<boolean> {
    const pending = (await this.store.pendingFor(userId)).filter(
      (check) => !guildId || check.guildId === guildId,
    );
    const check = pending[0];
    if (!check) {
      if (guildId === null) this.inbox.remove(userId);
      return false;
    }
    await inGuild(check.guildId, async () => {
      const { platform } = this.ctx.services;
      const guild = await platform.guild(check.guildId);
      const guildName = guild?.name ?? '';
      if (/^\s*new\s*$/i.test(text)) {
        await this.refresh(check, reply);
        return;
      }
      if (normalizeAnswer(text) === '') {
        await reply(copy.dm.how(await this.ctx.services.guilds.prefix(null)));
        return;
      }
      if (check.code && matches(text, check.code)) {
        const resolved = await this.store.resolve(check.id, 'passed');
        if (!resolved) return;
        await this.guard.release(check.guildId, userId, null);
        await reply(copy.dm.passed(guildName));
        await this.store.event({
          guildId: check.guildId,
          kind: 'verify',
          userId,
          actorId: null,
          summary: 'passed',
          detail: { attempts: check.attempts + 1, score: check.score },
        });
        await this.#finish(resolved, 'passed');
        return;
      }
      const config = await this.ctx.config(check.guildId);
      const attempts = await this.store.attempt(check.id);
      const left = config.verification.attempts - attempts;
      if (left > 0) {
        await reply(copy.dm.wrong(left));
        return;
      }
      const resolved = await this.store.resolve(check.id, 'failed');
      if (!resolved) return;
      const kick = config.verification.onExpire === 'kick';
      await reply(kick ? copy.dm.kicked(guildName) : copy.dm.failed(guildName));
      if (kick) await this.guard.punish(check.guildId, userId, 'kick', reasons.failed);
      else await this.feed.check(check.guildId, userId, check.id, 'failed');
      await this.#finish(resolved, 'failed');
    });
    return true;
  }

  async refresh(check: SecurityCheck, reply: (content: string) => Promise<unknown>): Promise<void> {
    const captcha = await renderCaptcha();
    await this.store.setCode(check.id, captcha.code, check.method ?? 'dm');
    const color = copy.colors[captcha.color];
    const sent = await this.ctx.services.platform.sendDirect(check.userId, {
      content: lines(copy.dm.fresh, copy.dm.intro(color)),
      files: [{ name: CAPTCHA_FILE, data: captcha.png }],
    });
    if (!sent) await reply(lines(copy.dm.fresh, copy.dm.intro(color)));
  }

  async expire(job: Job): Promise<void> {
    const guildId = job.guildId;
    const checkId = typeof job.payload.checkId === 'string' ? job.payload.checkId : null;
    if (!guildId || !checkId) return;
    const check = await this.store.check(guildId, checkId);
    if (check?.status !== 'pending') return;
    const resolved = await this.store.resolve(check.id, 'expired');
    if (!resolved) return;
    const config = await this.ctx.config(guildId);
    const guild = await this.ctx.services.platform.guild(guildId);
    const kick = config.verification.onExpire === 'kick';
    await this.ctx.services.platform
      .sendDirect(
        check.userId,
        kick ? copy.dm.expiredKick(guild?.name ?? '') : copy.dm.expired(guild?.name ?? ''),
      )
      .catch(() => false);
    if (kick) await this.guard.punish(guildId, check.userId, 'kick', reasons.expired);
    else await this.feed.check(guildId, check.userId, check.id, 'expired');
    await this.#finish(resolved, 'expired');
  }

  async pass(guildId: string, userId: string, by: string | null): Promise<boolean> {
    const check = await this.store.resolveMember(guildId, userId, 'released');
    const released = await this.guard.release(guildId, userId, by);
    if (check) await this.#finish(check, 'released');
    await this.feed.checksClosedFor(guildId, userId, 'released', by);
    return check !== null || released;
  }

  async onLeave(guildId: string, userId: string): Promise<void> {
    const check = await this.store.resolveMember(guildId, userId, 'left');
    if (check) await this.#finish(check, 'left');
    await this.feed.checksClosedFor(guildId, userId, 'left', null);
  }

  async onMemberUpdate(update: MemberUpdate): Promise<void> {
    if (!update.before) return;
    const { roleId } = await this.guard.gate(update.guildId);
    if (!roleId || !update.before.roles.includes(roleId) || update.roles.includes(roleId)) return;
    const check = await this.store.resolveMember(update.guildId, update.user.id, 'released');
    if (check) await this.#finish(check, 'released');
  }

  async recheck(guildId: string, userIds: readonly string[]): Promise<void> {
    const config = await this.ctx.config(guildId);
    if (!config.verification.enabled) return;
    const { platform } = this.ctx.services;
    for (const userId of new Set(userIds)) {
      if (await this.store.pending(guildId, userId)) continue;
      const member = await platform.member(guildId, userId).catch(() => null);
      if (!member || member.user.bot) continue;
      const last = (await this.store.recentChecks(guildId, 50)).find(
        (check) => check.userId === userId,
      );
      if (last?.status !== 'clear') continue;
      const known = storedReasons(last.reasons);
      await this.#challenge(
        guildId,
        config,
        userId,
        member.user.displayName,
        member.user.avatarUrl,
        last.score,
        [...known, { key: 'raid' }],
      );
    }
  }

  async load(guildIds: readonly string[]): Promise<void> {
    this.inbox.load(await this.store.pendingAll(guildIds));
  }
}

export function joinEmbed(
  userId: string,
  name: string,
  avatarUrl: string | null,
  score: number,
  why: string[],
  status: CheckStatus,
  note?: string,
): Embed {
  const color =
    status === 'clear' || status === 'passed' || status === 'released'
      ? palette.success
      : status === 'pending'
        ? palette.warning
        : palette.danger;
  return {
    color,
    author: avatarUrl ? { name, iconUrl: avatarUrl } : { name },
    title: copy.log.title(name),
    description: note ?? (status === 'clear' ? copy.log.clear : undefined),
    fields: [
      { name: copy.log.user, value: `${mention.user(userId)} (${userId})`, inline: false },
      { name: copy.log.verification, value: statusText(status), inline: true },
      { name: copy.log.score, value: String(score), inline: true },
      {
        name: copy.log.reasons,
        value: why.length > 0 ? why.join(', ').slice(0, 1024) : copy.log.noReasons,
        inline: false,
      },
    ],
    timestamp: new Date(),
  };
}
