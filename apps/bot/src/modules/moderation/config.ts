export {
  type CaseAction,
  type ModerationConfig,
  moderationConfig,
} from '@maxwell/core/modules/moderation';

export const MODULE = 'moderation';

export const MAX_TIMEOUT_MS = 365 * 86_400_000;
export const MIN_BAN_MS = 60_000;
export const MAX_BAN_MS = 63_072_000_000;
export const MAX_SLOWMODE_SECONDS = 21_600;
export const PURGE_MAX = 1_000;
export const PURGE_CONFIRM_ABOVE = 100;
export const PURGE_SCAN_MAX = 3_000;
export const NAME_HISTORY_DAYS = 365;
export const NAME_RISK_DAYS = 30;

export type ExecutableAction = 'ban' | 'unban' | 'kick' | 'timeout' | 'untimeout' | 'warn' | 'flag';

export function expiryKey(guildId: string, number: number): string {
  return `moderation.expire:${guildId}:${number}`;
}

export function unlockKey(guildId: string, channelId: string): string {
  return `moderation.unlock:${guildId}:${channelId}`;
}
