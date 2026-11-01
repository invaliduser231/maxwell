import {
  type Finding,
  type FindingKey,
  type FixPlan,
  findingKeys,
} from '@maxwell/core/modules/security-check';

export type FixTarget = { all: true } | { key: FindingKey; roleId: string | null };

export type FixModule = 'security' | 'automod' | 'moderation';

const moduleKeys: Record<FixModule, readonly FindingKey[]> = {
  security: ['nukeOff', 'raidOff', 'verificationOff', 'securityLog'],
  automod: ['automodRules'],
  moderation: ['modRoles', 'modLog'],
};

export function parseFixTarget(value: unknown): FixTarget | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { all?: unknown; key?: unknown; roleId?: unknown };
  if (raw.all === true) return { all: true };
  const key = findingKeys.find((entry) => entry === raw.key);
  if (!key) return null;
  if (raw.roleId === undefined || raw.roleId === null) return { key, roleId: null };
  if (typeof raw.roleId !== 'string' || !/^\d{1,21}$/.test(raw.roleId)) return null;
  return { key, roleId: raw.roleId };
}

export function selectFixes(findings: readonly Finding[], target: FixTarget): Finding[] {
  if ('all' in target) return findings.filter((entry) => entry.fixable && entry.safe);
  return findings
    .filter((entry) => entry.fixable && entry.key === target.key)
    .filter((entry) => target.roleId === null || entry.roleIds.includes(target.roleId))
    .slice(0, 1);
}

export function fixModules(plan: FixPlan): FixModule[] {
  const touched = new Set<FixModule>();
  if (plan.security) touched.add('security');
  if (plan.automod) touched.add('automod');
  if (plan.moderation) touched.add('moderation');
  for (const key of plan.enable) touched.add(key);
  return [...touched];
}

export function keysFor(plan: FixPlan, module: FixModule): FindingKey[] {
  const keys = plan.keys.map((key) => (key === 'automodOff' ? 'automodRules' : key));
  return [...new Set(keys)].filter((key) => moduleKeys[module].includes(key));
}

export function needsAdmin(plan: FixPlan): boolean {
  return plan.roles.some((role) => role.key === 'botAdmin');
}
