import type { RolesStore } from '@maxwell/core/stores/roles';
import type { PrivacyHandler } from '../../runtime/privacy.js';
import type { Members } from './members.js';

export function rolesPrivacy(
  store: Pick<
    RolesStore,
    'member' | 'timeGranted' | 'temporaryFor' | 'activityFor' | 'forgetMember'
  >,
  members: Pick<Members, 'forgetCached'>,
): PrivacyHandler {
  return {
    async export(guildId, userId) {
      const [member, timeRoles, temporary, activity] = await Promise.all([
        store.member(guildId, userId),
        store.timeGranted(guildId, userId),
        store.temporaryFor(guildId, userId),
        store.activityFor(guildId, userId),
      ]);
      if (
        !member &&
        timeRoles.length === 0 &&
        temporary.length === 0 &&
        activity.days.length === 0 &&
        activity.roleIds.length === 0
      ) {
        return null;
      }
      return {
        membership: member
          ? {
              joinedAt: member.joinedAt?.toISOString() ?? null,
              leftAt: member.leftAt?.toISOString() ?? null,
              stickyRoleIds: member.stickyRoleIds,
            }
          : null,
        timeRoles: timeRoles.map((grant) => ({
          roleId: grant.roleId,
          grantedAt: grant.grantedAt.toISOString(),
        })),
        temporaryRoles: temporary.map((row) => ({
          roleId: row.roleId,
          expiresAt: row.expiresAt.toISOString(),
        })),
        activity: activity.days,
        activityRoles: activity.roleIds,
      };
    },
    async forget(guildId, userId) {
      await store.forgetMember(guildId, userId);
      members.forgetCached(guildId, userId);
    },
  };
}
