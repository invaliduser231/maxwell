import { findTemplate, type ReasonTemplate } from '@maxwell/core/modules/moderation';
import type { ExecutableAction, ModerationConfig } from './config.js';

const DAY_SECONDS = 86_400;

export interface Expanded {
  reason: string | null;
  durationMs: number | null;
  deleteMessageSeconds: number | null;
  template: ReasonTemplate | null;
}

export function deleteSecondsFor(config: Pick<ModerationConfig, 'banDeleteMessageDays'>): number {
  return Math.max(config.banDeleteMessageDays, 1) * DAY_SECONDS;
}

export function expandReason(
  config: Pick<ModerationConfig, 'reasonTemplates' | 'banDeleteMessageDays'>,
  action: ExecutableAction,
  reason: string | null,
  durationMs: number | null,
): Expanded {
  const template = findTemplate(config.reasonTemplates, reason);
  if (!template) return { reason, durationMs, deleteMessageSeconds: null, template: null };
  const timeout =
    action === 'timeout' && durationMs === null && template.timeoutMinutes !== null
      ? template.timeoutMinutes * 60_000
      : durationMs;
  return {
    reason: template.text,
    durationMs: timeout,
    deleteMessageSeconds:
      action === 'ban' && template.deleteMessages ? deleteSecondsFor(config) : null,
    template,
  };
}
