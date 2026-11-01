import type { AutomodConfig, AutomodRuleKey } from './automod.js';
import type { ModerationConfig } from './moderation.js';
import type { SecurityConfig } from './security.js';

export const checkPermissions = {
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  MentionEveryone: 1n << 17n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ModerateMembers: 1n << 40n,
} as const;

export type CheckPermission = keyof typeof checkPermissions;

export const everyoneDanger: readonly CheckPermission[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'MentionEveryone',
];

const rolePower: readonly CheckPermission[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
];

const moderatorPower: readonly CheckPermission[] = [
  'Administrator',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
];

export const keyAutomodRules = [
  'spam',
  'mentions',
  'newAccountLinks',
  'invites',
] as const satisfies readonly AutomodRuleKey[];

export type KeyAutomodRule = (typeof keyAutomodRules)[number];

export const findingKeys = [
  'securityOff',
  'everyone',
  'botPosition',
  'botAdmin',
  'nukeOff',
  'automodOff',
  'automodRules',
  'raidOff',
  'verificationOff',
  'adminRoles',
  'modRoles',
  'securityLog',
  'modLog',
] as const;

export type FindingKey = (typeof findingKeys)[number];

export const severities = ['high', 'medium', 'low'] as const;

export type Severity = (typeof severities)[number];

export const severityWeights: Record<Severity, number> = { high: 20, medium: 10, low: 4 };

export interface CheckRole {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}

export interface HealthInput {
  guildId: string;
  roles: readonly CheckRole[];
  selfRoleIds: readonly string[] | null;
  security: { enabled: boolean; config: SecurityConfig };
  automod: { enabled: boolean; config: AutomodConfig };
  moderation: { enabled: boolean; config: ModerationConfig };
}

export interface Finding {
  key: FindingKey;
  severity: Severity;
  roleIds: string[];
  names: string[];
  fixable: boolean;
  safe: boolean;
}

export interface Health {
  score: number;
  findings: Finding[];
}

export interface FixPlan {
  keys: FindingKey[];
  enable: ('security' | 'automod')[];
  security: Partial<SecurityConfig> | null;
  automod: Partial<AutomodConfig> | null;
  moderation: Partial<ModerationConfig> | null;
  roles: { roleId: string; permissions: string; key: FindingKey }[];
}

export function permissionValue(bits: string): bigint {
  try {
    return BigInt(bits);
  } catch {
    return 0n;
  }
}

export function grants(bits: string, names: readonly CheckPermission[]): CheckPermission[] {
  const value = permissionValue(bits);
  return names.filter((name) => (value & checkPermissions[name]) !== 0n);
}

function mask(names: readonly string[]): bigint {
  return names.reduce(
    (acc, name) =>
      name in checkPermissions ? acc | checkPermissions[name as CheckPermission] : acc,
    0n,
  );
}

export function topPosition(roles: readonly CheckRole[], ids: readonly string[]): number {
  return Math.max(0, ...ids.map((id) => roles.find((role) => role.id === id)?.position ?? 0));
}

function finding(
  key: FindingKey,
  severity: Severity,
  extra: Partial<Omit<Finding, 'key' | 'severity'>> = {},
): Finding {
  return { key, severity, roleIds: [], names: [], fixable: true, safe: true, ...extra };
}

function offRules(config: AutomodConfig): KeyAutomodRule[] {
  return keyAutomodRules.filter((key) => config.rules[key].mode === 'off');
}

export function scoreOf(findings: readonly Finding[]): number {
  const lost = findings.reduce((sum, entry) => sum + severityWeights[entry.severity], 0);
  return Math.max(0, Math.min(100, 100 - lost));
}

export function securityHealth(input: HealthInput): Health {
  const { guildId, roles, selfRoleIds, security, automod, moderation } = input;
  const findings: Finding[] = [];
  const self = new Set(selfRoleIds ?? []);
  const top = selfRoleIds ? topPosition(roles, selfRoleIds) : null;
  const people = roles.filter((role) => role.id !== guildId && !role.managed && !self.has(role.id));

  if (!security.enabled) findings.push(finding('securityOff', 'high'));

  const everyone = roles.find((role) => role.id === guildId);
  const open = everyone ? grants(everyone.permissions, everyoneDanger) : [];
  if (open.length > 0) {
    const severity = open.every((name) => name === 'MentionEveryone') ? 'medium' : 'high';
    findings.push(finding('everyone', severity, { roleIds: [guildId], names: open }));
  }

  if (top !== null) {
    const above = people
      .filter((role) => role.position >= top)
      .sort((a, b) => b.position - a.position);
    if (above.length > 0) {
      const severity = above.some((role) => grants(role.permissions, rolePower).length > 0)
        ? 'high'
        : 'medium';
      findings.push(
        finding('botPosition', severity, {
          roleIds: above.map((role) => role.id),
          names: above.map((role) => role.name),
          fixable: false,
          safe: false,
        }),
      );
    }
  }

  for (const role of roles) {
    if (role.id === guildId || !role.managed || self.has(role.id)) continue;
    if (grants(role.permissions, ['Administrator']).length === 0) continue;
    findings.push(
      finding('botAdmin', 'medium', {
        roleIds: [role.id],
        names: [role.name],
        fixable: top !== null && role.position < top,
        safe: false,
      }),
    );
  }

  if (!security.config.nuke.enabled) findings.push(finding('nukeOff', 'high'));

  const rules = offRules(automod.config);
  if (!automod.enabled) {
    findings.push(finding('automodOff', 'high', { names: rules }));
  } else if (rules.length > 0) {
    findings.push(finding('automodRules', 'medium', { names: rules }));
  }

  if (!security.config.raid.enabled) findings.push(finding('raidOff', 'medium'));
  if (!security.config.verification.enabled) {
    findings.push(
      finding('verificationOff', 'medium', { fixable: automod.config.raid.gateRoleId !== null }),
    );
  }

  const admins = people.filter((role) => grants(role.permissions, ['Administrator']).length > 0);
  if (admins.length >= 2) {
    findings.push(
      finding('adminRoles', 'low', {
        roleIds: admins.map((role) => role.id),
        names: admins.map((role) => role.name),
        fixable: false,
        safe: false,
      }),
    );
  }

  const known = new Set(moderation.config.modRoleIds);
  const mods = people
    .filter((role) => !known.has(role.id) && grants(role.permissions, moderatorPower).length > 0)
    .sort((a, b) => b.position - a.position);
  if (mods.length > 0) {
    findings.push(
      finding('modRoles', 'low', {
        roleIds: mods.map((role) => role.id),
        names: mods.map((role) => role.name),
      }),
    );
  }

  if (!security.config.logChannelId) {
    findings.push(
      finding('securityLog', 'low', { fixable: moderation.config.logChannelId !== null }),
    );
  }
  if (!moderation.config.logChannelId) {
    findings.push(finding('modLog', 'low', { fixable: security.config.logChannelId !== null }));
  }

  const order = (entry: Finding) => severities.indexOf(entry.severity);
  const sorted = findings
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => order(a.entry) - order(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
  return { score: scoreOf(sorted), findings: sorted };
}

export function fixPlan(input: HealthInput, findings: readonly Finding[]): FixPlan {
  const plan: FixPlan = {
    keys: [],
    enable: [],
    security: null,
    automod: null,
    moderation: null,
    roles: [],
  };
  const security = input.security.config;
  const automod = input.automod.config;
  const moderation = input.moderation.config;
  const patchSecurity = (patch: Partial<SecurityConfig>) => {
    plan.security = { ...plan.security, ...patch };
  };
  const patchModeration = (patch: Partial<ModerationConfig>) => {
    plan.moderation = { ...plan.moderation, ...patch };
  };
  const enableRules = (names: readonly string[]) => {
    const keys = keyAutomodRules.filter((key) => names.includes(key));
    if (keys.length === 0) return;
    const enforced = keys.map((key) => [key, { ...automod.rules[key], mode: 'enforce' }]);
    plan.automod = {
      ...plan.automod,
      rules: { ...automod.rules, ...Object.fromEntries(enforced) },
    };
  };

  for (const entry of findings) {
    if (!entry.fixable) continue;
    if (entry.key !== 'botAdmin' && plan.keys.includes(entry.key)) continue;
    switch (entry.key) {
      case 'securityOff':
        plan.enable.push('security');
        break;
      case 'automodOff':
        plan.enable.push('automod');
        enableRules(entry.names);
        break;
      case 'automodRules':
        enableRules(entry.names);
        break;
      case 'nukeOff':
        patchSecurity({ nuke: { ...security.nuke, enabled: true } });
        break;
      case 'raidOff':
        patchSecurity({ raid: { ...security.raid, enabled: true } });
        break;
      case 'verificationOff':
        if (!automod.raid.gateRoleId) continue;
        patchSecurity({ verification: { ...security.verification, enabled: true } });
        break;
      case 'securityLog':
        if (!moderation.logChannelId) continue;
        patchSecurity({ logChannelId: moderation.logChannelId });
        break;
      case 'modLog':
        if (!security.logChannelId) continue;
        patchModeration({ logChannelId: security.logChannelId });
        break;
      case 'modRoles':
        patchModeration({
          modRoleIds: [...new Set([...moderation.modRoleIds, ...entry.roleIds])].slice(0, 25),
        });
        break;
      case 'everyone':
      case 'botAdmin': {
        const roleId = entry.roleIds[0];
        const role = input.roles.find((item) => item.id === roleId);
        if (!role) continue;
        const remove = mask(entry.key === 'everyone' ? entry.names : ['Administrator']);
        const next = permissionValue(role.permissions) & ~remove;
        if (next === permissionValue(role.permissions)) continue;
        plan.roles.push({ roleId: role.id, permissions: next.toString(), key: entry.key });
        break;
      }
      default:
        continue;
    }
    if (!plan.keys.includes(entry.key)) plan.keys.push(entry.key);
  }
  return plan;
}

export function onlyRemoves(before: string, after: string): boolean {
  const current = permissionValue(before);
  const next = permissionValue(after);
  return next !== current && (next & ~current) === 0n;
}

const fixSummaries: Record<FindingKey, string> = {
  securityOff: 'turned on Security',
  everyone: 'removed dangerous permissions from @everyone',
  botPosition: 'moved Maxwell up',
  botAdmin: 'removed Administrator from a bot role',
  nukeOff: 'turned on nuke watch',
  automodOff: 'turned on AutoMod',
  automodRules: 'turned on key AutoMod rules',
  raidOff: 'turned on raid watch',
  verificationOff: 'turned on the captcha',
  adminRoles: 'cut back Administrator roles',
  modRoles: 'added mod roles to Moderation',
  securityLog: 'set the Security log channel',
  modLog: 'set the Moderation log channel',
};

export function fixSummary(keys: readonly FindingKey[]): string {
  const parts = keys.map((key) => fixSummaries[key]);
  if (parts.length <= 1) return `Security check: ${parts[0] ?? 'nothing to fix'}`;
  return `Security check: ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
