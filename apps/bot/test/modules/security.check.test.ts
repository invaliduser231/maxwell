import { automodConfig } from '@maxwell/core/modules/automod';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import { securityConfig } from '@maxwell/core/modules/security';
import {
  type CheckRole,
  checkPermissions,
  fixPlan,
  fixSummary,
  type HealthInput,
  onlyRemoves,
  scoreOf,
  securityHealth,
} from '@maxwell/core/modules/security-check';
import { describe, expect, it } from 'vitest';
import type { GuildContext } from '../../src/commands/types.js';
import { withLanguage } from '../../src/i18n/language.js';
import { checkCommand, findingText, healthLines } from '../../src/modules/security/check.js';
import type { Ctx } from '../../src/modules/security/guard.js';

const guildId = '900000000000000001';

const bits = (...names: (keyof typeof checkPermissions)[]) =>
  names.reduce((acc, name) => acc | checkPermissions[name], 0n).toString();

function role(id: string, position: number, permissions = '0', managed = false): CheckRole {
  return { id, name: `role-${id}`, position, permissions, managed };
}

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  const automod = automodConfig.parse({});
  for (const key of ['spam', 'mentions', 'newAccountLinks', 'invites'] as const) {
    automod.rules[key].mode = 'enforce';
  }
  automod.raid.gateRoleId = '700';
  const security = securityConfig.parse({});
  security.raid.enabled = true;
  security.nuke.enabled = true;
  security.verification.enabled = true;
  security.logChannelId = '800';
  const moderation = moderationConfig.parse({});
  moderation.logChannelId = '801';
  return {
    guildId,
    roles: [role(guildId, 0), role('10', 10)],
    selfRoleIds: ['10'],
    security: { enabled: true, config: security },
    automod: { enabled: true, config: automod },
    moderation: { enabled: true, config: moderation },
    ...overrides,
  };
}

describe('security health', () => {
  it('gives a clean community full marks', () => {
    const health = securityHealth(input());
    expect(health.findings).toEqual([]);
    expect(health.score).toBe(100);
  });

  it('flags dangerous @everyone permissions as high and fixable', () => {
    const health = securityHealth(
      input({ roles: [role(guildId, 0, bits('BanMembers', 'MentionEveryone')), role('10', 10)] }),
    );
    expect(health.findings).toEqual([
      expect.objectContaining({
        key: 'everyone',
        severity: 'high',
        names: ['BanMembers', 'MentionEveryone'],
        fixable: true,
        safe: true,
      }),
    ]);
    expect(health.score).toBe(80);
  });

  it('rates @everyone mentions alone as medium', () => {
    const health = securityHealth(
      input({ roles: [role(guildId, 0, bits('MentionEveryone')), role('10', 10)] }),
    );
    expect(health.findings[0]).toMatchObject({ key: 'everyone', severity: 'medium' });
  });

  it('notices when Maxwell sits below a powerful role', () => {
    const health = securityHealth(
      input({ roles: [role(guildId, 0), role('10', 5), role('20', 8, bits('KickMembers'))] }),
    );
    const below = health.findings.find((entry) => entry.key === 'botPosition');
    expect(below).toMatchObject({ severity: 'high', roleIds: ['20'], fixable: false });
  });

  it('skips role checks when the bot roles are unknown', () => {
    const health = securityHealth(
      input({ roles: [role(guildId, 0), role('20', 8, bits('KickMembers'))], selfRoleIds: null }),
    );
    expect(health.findings.map((entry) => entry.key)).not.toContain('botPosition');
  });

  it('flags other bots with Administrator and only fixes those below Maxwell', () => {
    const health = securityHealth(
      input({
        roles: [
          role(guildId, 0),
          role('10', 10),
          role('30', 4, bits('Administrator'), true),
          role('31', 12, bits('Administrator'), true),
        ],
        moderation: {
          enabled: true,
          config: { ...input().moderation.config, modRoleIds: [] },
        },
      }),
    );
    const bots = health.findings.filter((entry) => entry.key === 'botAdmin');
    expect(bots.map((entry) => [entry.roleIds[0], entry.fixable, entry.safe])).toEqual([
      ['30', true, false],
      ['31', false, false],
    ]);
  });

  it('lists roles that can moderate but are not mod roles', () => {
    const health = securityHealth(
      input({
        roles: [role(guildId, 0), role('10', 10), role('40', 3, bits('ModerateMembers'))],
      }),
    );
    expect(health.findings).toEqual([
      expect.objectContaining({ key: 'modRoles', severity: 'low', roleIds: ['40'] }),
    ]);
  });

  it('reports module and rule gaps sorted by severity', () => {
    const base = input();
    const automod = automodConfig.parse({});
    const health = securityHealth({
      ...base,
      automod: { enabled: true, config: automod },
      security: {
        enabled: true,
        config: { ...base.security.config, nuke: { ...base.security.config.nuke, enabled: false } },
      },
    });
    expect(health.findings.map((entry) => entry.key)).toEqual(['nukeOff', 'automodRules']);
    expect(health.findings[1]?.names).toEqual(['spam', 'mentions', 'newAccountLinks', 'invites']);
    expect(health.findings.find((entry) => entry.key === 'verificationOff')).toBeUndefined();
  });

  it('cannot fix the captcha without a gate role', () => {
    const base = input();
    const health = securityHealth({
      ...base,
      automod: {
        enabled: true,
        config: { ...base.automod.config, raid: { ...base.automod.config.raid, gateRoleId: null } },
      },
      security: {
        enabled: true,
        config: {
          ...base.security.config,
          verification: { ...base.security.config.verification, enabled: false },
        },
      },
    });
    expect(health.findings).toEqual([
      expect.objectContaining({ key: 'verificationOff', fixable: false }),
    ]);
  });

  it('never drops below zero', () => {
    expect(
      scoreOf(
        Array.from({ length: 10 }, () => ({
          key: 'nukeOff' as const,
          severity: 'high' as const,
          roleIds: [],
          names: [],
          fixable: true,
          safe: true,
        })),
      ),
    ).toBe(0);
  });
});

describe('security fix plan', () => {
  it('turns on what is off and strips only the flagged permissions', () => {
    const base = input();
    const everyone = bits('BanMembers', 'MentionEveryone');
    const full = {
      ...base,
      roles: [role(guildId, 0, (BigInt(everyone) | (1n << 10n)).toString()), role('10', 10)],
      automod: { enabled: false, config: automodConfig.parse({}) },
      security: {
        enabled: true,
        config: {
          ...base.security.config,
          raid: { ...base.security.config.raid, enabled: false },
          logChannelId: null,
        },
      },
    };
    const health = securityHealth(full);
    const plan = fixPlan(
      full,
      health.findings.filter((entry) => entry.fixable && entry.safe),
    );
    expect(plan.enable).toEqual(['automod']);
    expect(plan.security?.raid?.enabled).toBe(true);
    expect(plan.security?.logChannelId).toBe('801');
    expect(plan.automod?.rules?.spam.mode).toBe('enforce');
    expect(plan.automod?.rules?.caps.mode).toBe('off');
    expect(plan.roles).toEqual([
      { roleId: guildId, permissions: (1n << 10n).toString(), key: 'everyone' },
    ]);
  });

  it('adds missing mod roles without losing the old ones', () => {
    const base = input();
    const full = {
      ...base,
      roles: [role(guildId, 0), role('10', 10), role('40', 3, bits('BanMembers'))],
      moderation: { enabled: true, config: { ...base.moderation.config, modRoleIds: ['41'] } },
    };
    const plan = fixPlan(full, securityHealth(full).findings);
    expect(plan.moderation?.modRoleIds).toEqual(['41', '40']);
  });

  it('removes only Administrator from a bot role', () => {
    const base = input();
    const full = {
      ...base,
      roles: [
        role(guildId, 0),
        role('10', 10),
        role('30', 4, bits('Administrator', 'ManageRoles'), true),
      ],
    };
    const plan = fixPlan(full, securityHealth(full).findings);
    expect(plan.roles).toEqual([
      { roleId: '30', permissions: bits('ManageRoles'), key: 'botAdmin' },
    ]);
  });

  it('skips findings that cannot be fixed', () => {
    const base = input();
    const full = {
      ...base,
      roles: [role(guildId, 0), role('10', 5), role('20', 8, bits('KickMembers'))],
    };
    expect(fixPlan(full, securityHealth(full).findings).keys).toEqual(['modRoles']);
  });

  it('only accepts permission changes that take something away', () => {
    expect(onlyRemoves(bits('BanMembers', 'KickMembers'), bits('KickMembers'))).toBe(true);
    expect(onlyRemoves(bits('KickMembers'), bits('KickMembers'))).toBe(false);
    expect(onlyRemoves(bits('KickMembers'), bits('Administrator'))).toBe(false);
  });

  it('writes a readable audit summary', () => {
    expect(fixSummary(['raidOff'])).toBe('Security check: turned on raid watch');
    expect(fixSummary(['raidOff', 'nukeOff', 'securityLog'])).toBe(
      'Security check: turned on raid watch, turned on nuke watch and set the Security log channel',
    );
  });
});

describe('security check copy', () => {
  it('describes findings in both languages', () => {
    const base = input();
    const health = securityHealth({
      ...base,
      roles: [role(guildId, 0, bits('Administrator')), role('10', 10)],
    });
    const [first] = health.findings;
    expect(first ? findingText(first) : null).toBe('@everyone has Administrator.');
    withLanguage('de', () => {
      expect(healthLines(health)).toEqual(['**Hoch**: @everyone hat Administrator.']);
    });
  });
});

describe('security check command', () => {
  it('posts the score, the top findings and a link to the dashboard', async () => {
    const ctx = {
      enabled: async () => true,
      config: async () => securityConfig.parse({}),
      services: {
        platform: { selfId: null, roles: async () => [], member: async () => null },
        settings: {
          enabled: async () => true,
          config: async (
            _guild: string,
            _key: string,
            schema: { parse(value: unknown): unknown },
          ) => schema.parse({}),
        },
      },
    } as unknown as Ctx;
    const replies: { embeds: { title: string; description: string }[] }[] = [];
    const cmd = {
      guildId,
      services: { config: { DASHBOARD_URL: 'https://maxwell.test/' } },
      reply: async (message: (typeof replies)[number]) => {
        replies.push(message);
        return '1';
      },
    } as unknown as GuildContext;
    await checkCommand(ctx).run?.(cmd);
    const embed = replies[0]?.embeds[0];
    expect(embed?.title).toBe('Security check: 42 of 100');
    expect(embed?.description).toContain('**High**: Nuke watch is off.');
    expect(embed?.description).toContain('1 more finding on the dashboard.');
    expect(embed?.description).toContain(`https://maxwell.test/g/${guildId}/security`);
  });
});
