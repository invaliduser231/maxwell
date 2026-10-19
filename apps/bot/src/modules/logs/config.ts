import type { LogEvent, LogsConfig } from '@maxwell/core/modules/logs';

export {
  type LogEvent,
  type LogsConfig,
  logEvents,
  logsConfig,
} from '@maxwell/core/modules/logs';

export const MODULE = 'logs';

export function routeFor(config: LogsConfig, event: LogEvent): string | null {
  const route = config.routes[event];
  if (!route?.enabled) return null;
  return route.channelId ?? config.defaultChannelId;
}

export function isIgnoredChannel(
  config: LogsConfig,
  channelId: string | null,
  parentId: string | null = null,
): boolean {
  if (!channelId) return false;
  return (
    config.ignoredChannelIds.includes(channelId) ||
    (parentId !== null && config.ignoredChannelIds.includes(parentId))
  );
}

export function hasIgnoredRole(config: LogsConfig, roles: readonly string[]): boolean {
  return roles.some((role) => config.ignoredRoleIds.includes(role));
}
