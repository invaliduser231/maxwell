import { mention } from '../../commands/mentions.js';
import { inGuild } from '../../i18n/language.js';
import type { Embed, JoinSource, MemberJoin, UserRef } from '../../platform/types.js';
import type { Services } from '../../services.js';
import { lines, snowflakeDate, subtext, timestamp } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { inviteConfig, MODULE } from './config.js';
import { copy } from './copy.js';
import type { InviteStore, JoinRow } from './store.js';

const RETRY_DELAYS = [1_500, 4_000, 10_000, 30_000, 120_000];
const RECONCILE_WINDOW = 24 * 60 * 60 * 1000;
const NEW_ACCOUNT = 7 * 24 * 60 * 60 * 1000;

type Outcome = { source: JoinSource } | { missing: 'permission' | 'unknown' };

export const JoinSourceType = {
  Creator: 0,
  Invite: 1,
  Vanity: 2,
  BotInvite: 3,
  AdminAdd: 4,
  Discovery: 6,
} as const;

export function describeSource(source: JoinSource): string {
  switch (source.type) {
    case JoinSourceType.Invite:
      if (source.inviteCode && source.inviterId) {
        return copy.source.inviteFrom(source.inviteCode, source.inviterId);
      }
      return source.inviteCode ? `\`${source.inviteCode}\`` : copy.source.invite;
    case JoinSourceType.Vanity:
      return copy.source.vanity;
    case JoinSourceType.Discovery:
      return copy.source.discovery;
    case JoinSourceType.BotInvite:
      return copy.source.bot;
    case JoinSourceType.Creator:
      return copy.source.creator;
    case JoinSourceType.AdminAdd:
      return copy.source.admin;
    default:
      return copy.source.unknown;
  }
}

export class InviteTracker {
  readonly #timers = new Set<NodeJS.Timeout>();
  readonly #forbiddenWarned = new Set<string>();
  #stopped = false;

  constructor(
    private readonly services: Services,
    private readonly store: InviteStore,
  ) {}

  async onJoin(join: MemberJoin): Promise<void> {
    const row = await this.store.recordJoin(join.guildId, join.user.id, join.joinedAt);
    if (row) this.#schedule(row, 0, join.user);
  }

  async onLeave(guildId: string, userId: string): Promise<void> {
    await this.store.recordLeave(guildId, userId);
  }

  async reconcile(): Promise<void> {
    const rows = await this.store.unresolved(new Date(Date.now() - RECONCILE_WINDOW));
    for (const row of rows) this.#schedule(row, 0, null);
    if (rows.length) this.services.log.info({ count: rows.length }, 'resuming invite lookups');
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #schedule(row: JoinRow, attempt: number, user: UserRef | null): void {
    const delay = RETRY_DELAYS[attempt];
    if (delay === undefined || this.#stopped) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      inGuild(row.guildId, () => this.#attempt(row, attempt, user)).catch((error) => {
        this.services.log.warn({ err: error, guild: row.guildId }, 'invite lookup failed');
        this.#schedule(row, attempt + 1, user);
      });
    }, delay);
    this.#timers.add(timer);
  }

  async #attempt(row: JoinRow, attempt: number, user: UserRef | null): Promise<void> {
    const result = await this.services.platform.joinSource(row.guildId, row.userId, row.joinedAt);

    if (result.status === 'forbidden') {
      await this.store.resolve(row.id, null);
      if (!this.#forbiddenWarned.has(row.guildId)) {
        this.#forbiddenWarned.add(row.guildId);
        this.services.log.info({ guild: row.guildId }, 'invite lookup needs Manage Community');
      }
      await this.#announce(row, { missing: 'permission' }, user);
      return;
    }

    if (result.status === 'pending') {
      if (attempt + 1 < RETRY_DELAYS.length) {
        this.#schedule(row, attempt + 1, user);
        return;
      }
      await this.store.resolve(row.id, null);
      await this.#announce(row, { missing: 'unknown' }, user);
      return;
    }

    await this.store.resolve(row.id, result.source);
    await this.#announce(row, { source: result.source }, user);
  }

  async #announce(row: JoinRow, outcome: Outcome, known: UserRef | null): Promise<void> {
    const { settings, platform, voice, log } = this.services;
    const config = await settings.config(row.guildId, MODULE, inviteConfig);
    if (!config.logChannelId) return;

    const [user, guild] = await Promise.all([
      known ?? platform.user(row.userId),
      platform.guild(row.guildId),
    ]);
    const created = snowflakeDate(row.userId);
    const age = row.joinedAt.getTime() - created.getTime();
    const source = 'source' in outcome ? outcome.source : null;
    const inviter = source?.inviterId && source.inviterId !== row.userId ? source.inviterId : null;
    const stats = inviter ? await this.store.inviterStats(row.guildId, inviter) : null;

    const who = mention.user(row.userId);
    const headline = source ? copy.join.through(who, describeSource(source)) : copy.join.plain(who);
    const hint =
      'missing' in outcome &&
      subtext(outcome.missing === 'permission' ? copy.join.needsPermission : copy.join.notTold);

    const embed: Embed = {
      color: palette.success,
      author: user
        ? { name: `${user.displayName} (@${user.username})`, iconUrl: user.avatarUrl }
        : undefined,
      title: user?.bot ? copy.join.botTitle : copy.join.memberTitle,
      description: lines(
        headline,
        inviter && stats && copy.join.inviterNow(mention.user(inviter), stats.active),
        hint,
        '',
        `**${copy.join.created}** ${timestamp(created, 'R')}`,
        age < NEW_ACCOUNT && `${voice.icon('warn')}${copy.join.young(age)}`,
      ),
      footer: [guild?.memberCount ? copy.join.number(guild.memberCount) : null, `ID ${row.userId}`]
        .filter(Boolean)
        .join(' / '),
      timestamp: row.joinedAt,
    };

    await platform.send(config.logChannelId, { embeds: [embed], silent: true }).catch((error) => {
      log.warn({ err: error, guild: row.guildId }, 'invite log channel unusable');
    });
  }
}
