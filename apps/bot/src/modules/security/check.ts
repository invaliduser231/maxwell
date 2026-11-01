import { automodConfig } from '@maxwell/core/modules/automod';
import { moderationConfig } from '@maxwell/core/modules/moderation';
import {
  type Finding,
  type Health,
  type HealthInput,
  onlyRemoves,
  securityHealth,
  topPosition,
} from '@maxwell/core/modules/security-check';
import type { Command } from '../../commands/types.js';
import type { RoleRef } from '../../platform/types.js';
import { lines, subtext } from '../../ui/format.js';
import { palette } from '../../ui/palette.js';
import { audit, copy, reasons } from './copy.js';
import type { Ctx } from './guard.js';

export const ROLE_FIX_JOB = 'security-check.role';

const TOP = 5;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function healthInput(ctx: Ctx, guildId: string): Promise<HealthInput> {
  const { platform, settings } = ctx.services;
  const [roles, self, security, automod, moderation] = await Promise.all([
    platform.roles(guildId).catch(() => [] as RoleRef[]),
    platform.selfId ? platform.member(guildId, platform.selfId).catch(() => null) : null,
    Promise.all([ctx.enabled(guildId), ctx.config(guildId)]),
    Promise.all([
      settings.enabled(guildId, 'automod'),
      settings.config(guildId, 'automod', automodConfig),
    ]),
    Promise.all([
      settings.enabled(guildId, 'moderation'),
      settings.config(guildId, 'moderation', moderationConfig),
    ]),
  ]);
  return {
    guildId,
    roles,
    selfRoleIds: self ? self.roles : null,
    security: { enabled: security[0], config: security[1] },
    automod: { enabled: automod[0], config: automod[1] },
    moderation: { enabled: moderation[0], config: moderation[1] },
  };
}

export function healthLines(health: Health, limit = TOP): string[] {
  return health.findings
    .slice(0, limit)
    .map((entry) => copy.check.line(copy.check.severity[entry.severity], findingText(entry)));
}

export function findingText(entry: Finding): string {
  return copy.check.findings[entry.key](entry.names);
}

export function checkCommand(ctx: Ctx): Command {
  return {
    name: 'check',
    description: copy.commands.check,
    guildOnly: true,
    permissions: ['ManageGuild'],
    cooldown: 10_000,
    examples: ['security check'],
    async run(cmd) {
      const health = securityHealth(await healthInput(ctx, cmd.guildId));
      const dashboard = cmd.services.config.DASHBOARD_URL?.replace(/\/+$/, '');
      const rest = health.findings.length - TOP;
      await cmd.reply({
        embeds: [
          {
            color:
              health.score >= 80
                ? palette.success
                : health.score >= 50
                  ? palette.warning
                  : palette.danger,
            title: copy.check.title(health.score),
            description: lines(
              health.findings.length === 0 ? copy.check.clean : null,
              ...healthLines(health),
              rest > 0 ? subtext(copy.check.more(rest)) : null,
              health.findings.some((entry) => entry.fixable)
                ? subtext(
                    copy.check.fixHint(dashboard ? `${dashboard}/g/${cmd.guildId}/security` : null),
                  )
                : null,
            ),
          },
        ],
      });
    },
  };
}

export function registerCheck(ctx: Ctx): void {
  const { services } = ctx;

  services.jobs.handle(ROLE_FIX_JOB, async (job) => {
    const roleId = text(job.payload.roleId);
    const permissions = text(job.payload.permissions);
    if (!job.guildId || !roleId || !permissions || !/^\d{1,20}$/.test(permissions)) return;
    const guildId = job.guildId;
    const { platform } = services;
    const [roles, self] = await Promise.all([
      platform.roles(guildId),
      platform.selfId ? platform.member(guildId, platform.selfId).catch(() => null) : null,
    ]);
    const role = roles.find((entry) => entry.id === roleId);
    if (!role || !onlyRemoves(role.permissions, permissions)) return;
    if (roleId !== guildId) {
      if (!self || self.roles.includes(roleId)) return;
      if (role.position >= topPosition(roles, self.roles)) return;
    }
    await platform.editRole(guildId, roleId, { permissionBits: permissions }, reasons.check);
    const summary = roleId === guildId ? audit.checkEveryone : audit.checkBotAdmin(role.name);
    await ctx.record(guildId, { id: text(job.payload.by) }, 'check.role', summary, {
      before: { roleId, permissions: role.permissions },
      after: { roleId, permissions },
      undo: { kind: 'check.role', payload: { roleId, permissions: role.permissions } },
    });
  });

  ctx.undo('check.role', async (entry, payload) => {
    const roleId = text(payload.roleId);
    const permissions = text(payload.permissions);
    if (!roleId || !permissions) return;
    await services.platform.editRole(
      entry.guildId,
      roleId,
      { permissionBits: permissions },
      reasons.checkUndo,
    );
  });
}
