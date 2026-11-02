import type { BackupStore } from '@maxwell/core/stores/backups';
import type { MemberLeave, MemberUpdate, RoleChange } from '../../platform/types.js';
import type { ModuleContext } from '../../runtime/module.js';
import type { backupsConfig } from './types.js';

const PAGE = 1000;
const MAX_PAGES = 500;
const GIVE_UP_AFTER = 10;

export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function highest(ids: readonly string[]): string | null {
  let top: bigint | null = null;
  for (const id of ids) {
    const value = BigInt(id);
    if (top === null || value > top) top = value;
  }
  return top === null ? null : top.toString();
}

export class MemberRoleBackup {
  constructor(
    private readonly ctx: ModuleContext<typeof backupsConfig>,
    private readonly store: BackupStore,
  ) {}

  async #liveRoles(guildId: string): Promise<string[]> {
    const roles = await this.ctx.services.platform.roles(guildId);
    return roles.map((role) => role.id).filter((id) => id !== guildId);
  }

  async onUpdate(update: MemberUpdate): Promise<void> {
    const { guildId } = update;
    if (update.before && sameRoles(update.before.roles, update.roles)) return;
    if (!(await this.ctx.config(guildId)).memberRoles) return;
    const live = await this.#liveRoles(guildId);
    await this.store.setMemberRoles(
      guildId,
      [{ userId: update.user.id, roleIds: update.roles.filter((id) => id !== guildId) }],
      live,
    );
  }

  async onLeave(leave: MemberLeave): Promise<void> {
    await this.store.forgetMemberRoles(leave.guildId, leave.userId);
  }

  async onRoleDelete(change: RoleChange): Promise<void> {
    await this.store.markRolesDeleted(change.guildId, [change.roleId]);
  }

  async sync(guildId: string, retentionDays: number): Promise<boolean> {
    const { platform } = this.ctx.services;
    if (!(await this.ctx.config(guildId)).memberRoles) {
      await this.store.clearMemberRoles(guildId);
      return false;
    }
    const live = await this.#liveRoles(guildId);
    await this.store.markMissingRoles(guildId, live);
    await this.store.pruneDeletedRoles(guildId, new Date(Date.now() - retentionDays * 86_400_000));
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const members = await platform.memberRoles(guildId, after, PAGE);
      if (members === null) return false;
      await this.store.setMemberRoles(
        guildId,
        members.map((member) => ({
          userId: member.userId,
          roleIds: member.roles.filter((id) => id !== guildId),
        })),
        live,
      );
      seen.push(...members.map((member) => member.userId));
      const next = highest(members.map((member) => member.userId));
      if (members.length < PAGE || next === null) {
        await this.store.keepMembers(guildId, seen);
        return true;
      }
      after = next;
    }
    return false;
  }

  async giveBack(guildId: string, from: string, to: string, reason: string): Promise<number> {
    const { platform, log } = this.ctx.services;
    const users = await this.store.roleMembers(guildId, from);
    if (users.length === 0) return 0;
    if (from !== to) await this.store.moveRoleMembers(guildId, from, to);
    let given = 0;
    let failedInRow = 0;
    for (const userId of users) {
      try {
        await platform.addRole(guildId, userId, to, reason);
        given++;
        failedInRow = 0;
      } catch (error) {
        failedInRow++;
        if (failedInRow < GIVE_UP_AFTER) continue;
        log.warn({ err: error, guild: guildId, role: to }, 'giving back member roles stopped');
        break;
      }
    }
    return given;
  }
}
