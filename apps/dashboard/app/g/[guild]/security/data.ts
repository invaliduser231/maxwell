import 'server-only';
import type { ModuleState } from '@maxwell/core';
import { automodConfig } from '@maxwell/core/modules/automod';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import { securityConfig } from '@maxwell/core/modules/security';
import {
  type Health,
  type HealthInput,
  securityHealth,
} from '@maxwell/core/modules/security-check';
import { SecurityStore } from '@maxwell/core/stores/security';
import { ShieldStore } from '@maxwell/core/stores/shield';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { botRoleIds, type GuildRole, guildRoles, PERMISSION } from '@/lib/fluxer';
import { people, personOf } from '@/lib/people';

const DANGEROUS =
  PERMISSION.Administrator |
  PERMISSION.ManageGuild |
  PERMISSION.ManageChannels |
  PERMISSION.ManageRoles |
  PERMISSION.BanMembers |
  PERMISSION.KickMembers |
  PERMISSION.ManageWebhooks;

export interface CheckRow {
  id: string;
  userId: string;
  name: string;
  avatar: string | null;
  score: number;
  reasons: {
    key: string;
    hours?: number;
    word?: string;
    size?: number;
    minutes?: number;
    count?: number;
  }[];
  status: string;
  at: number;
}

export interface EventRow {
  id: string;
  kind: string;
  summary: string;
  user: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  at: number;
}

export interface SecurityView {
  now: number;
  raid: { id: string; reason: string; startedAt: number; endsAt: number | null } | null;
  gateRoleId: string | null;
  gateChannelId: string | null;
  above: string[];
  counts: { checked: number; flagged: number; passed: number; failed: number; pending: number };
  checks: CheckRow[];
  events: EventRow[];
  shield: ShieldRow[];
  health: Health;
}

export interface ShieldRow {
  userId: string;
  name: string;
  avatar: string | null;
  source: string;
  expiresAt: number;
}

function dangerous(bits: string): boolean {
  try {
    return (BigInt(bits) & DANGEROUS) !== 0n;
  } catch {
    return false;
  }
}

function parse<T extends z.ZodType>(schema: T, state: ModuleState): z.output<T> {
  const parsed = schema.safeParse(state.config);
  return parsed.success ? parsed.data : schema.parse({});
}

function healthInput(
  guildId: string,
  roles: GuildRole[],
  mine: string[] | null,
  states: { security: ModuleState; automod: ModuleState; moderation: ModuleState },
): HealthInput {
  return {
    guildId,
    roles,
    selfRoleIds: mine,
    security: { enabled: states.security.enabled, config: parse(securityConfig, states.security) },
    automod: { enabled: states.automod.enabled, config: parse(automodConfig, states.automod) },
    moderation: {
      enabled: states.moderation.enabled,
      config: parse(moderationConfig, states.moderation),
    },
  };
}

export async function loadHealthInput(guildId: string): Promise<HealthInput> {
  const { modules } = db();
  const [roles, mine, security, automod, moderation] = await Promise.all([
    guildRoles(guildId).catch(() => []),
    botRoleIds(guildId),
    modules.state(guildId, 'security'),
    modules.state(guildId, 'automod'),
    modules.state(guildId, 'moderation'),
  ]);
  return healthInput(guildId, roles, mine, { security, automod, moderation });
}

export async function securityView(guildId: string): Promise<SecurityView> {
  const { sql, modules } = db();
  const store = new SecurityStore(sql);
  const now = Date.now();
  const [raid, counts, checks, events, automod, roles, mine, shared, own, moderation] =
    await Promise.all([
      store.activeRaid(guildId),
      store.counts(guildId, new Date(now - 86_400_000)),
      store.recentChecks(guildId, 25),
      store.events(guildId, 25),
      modules.state(guildId, 'automod'),
      guildRoles(guildId).catch(() => []),
      botRoleIds(guildId),
      new ShieldStore(sql).list(guildId, 50),
      modules.state(guildId, 'security'),
      modules.state(guildId, 'moderation'),
    ]);
  const gate = automodConfig.safeParse(automod.config);
  const raidConfig = gate.success ? gate.data.raid : automodConfig.parse({}).raid;

  const top = Math.max(
    0,
    ...(mine ?? []).map((id) => roles.find((role) => role.id === id)?.position ?? 0),
  );
  const above =
    mine === null
      ? []
      : roles
          .filter(
            (role) => role.id !== guildId && role.position >= top && dangerous(role.permissions),
          )
          .filter((role) => !(mine ?? []).includes(role.id))
          .sort((a, b) => b.position - a.position)
          .map((role) => role.name);

  const names = await people([
    ...checks.map((check) => check.userId),
    ...events.flatMap((event) => [event.userId, event.actorId]),
    ...shared.map((report) => report.userId),
  ]);

  return {
    now,
    raid: raid
      ? {
          id: raid.id,
          reason: raid.reason,
          startedAt: raid.startedAt.getTime(),
          endsAt: raid.endsAt?.getTime() ?? null,
        }
      : null,
    gateRoleId: raidConfig.gateRoleId,
    gateChannelId: raidConfig.gateChannelId,
    above,
    counts,
    checks: checks.map((check) => {
      const person = personOf(names, check.userId);
      return {
        id: check.id,
        userId: check.userId,
        name: person.name,
        avatar: person.avatar,
        score: check.score,
        reasons: (check.reasons as CheckRow['reasons']).filter(
          (reason) => reason && typeof reason === 'object' && typeof reason.key === 'string',
        ),
        status: check.status,
        at: check.createdAt.getTime(),
      };
    }),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      user: event.userId ? personOf(names, event.userId).name : null,
      actor: event.actorId ? personOf(names, event.actorId).name : null,
      detail: event.detail,
      at: event.createdAt.getTime(),
    })),
    health: securityHealth(
      healthInput(guildId, roles, mine, { security: own, automod, moderation }),
    ),
    shield: shared.map((report) => {
      const person = personOf(names, report.userId);
      return {
        userId: report.userId,
        name: person.name,
        avatar: person.avatar,
        source: report.source,
        expiresAt: report.expiresAt.getTime(),
      };
    }),
  };
}
