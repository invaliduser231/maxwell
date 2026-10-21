import type { EscalationStep } from '@maxwell/core/modules/moderation';

export function sortedSteps(steps: readonly EscalationStep[]): EscalationStep[] {
  const byCount = new Map<number, EscalationStep>();
  for (const step of steps) byCount.set(step.warns, step);
  return [...byCount.values()].sort((a, b) => a.warns - b.warns);
}

export function escalationFor(
  steps: readonly EscalationStep[],
  activeWarns: number,
): EscalationStep | null {
  const ladder = sortedSteps(steps);
  const top = ladder.at(-1);
  if (!top || activeWarns <= 0) return null;
  if (activeWarns >= top.warns) return top;
  return ladder.find((step) => step.warns === activeWarns) ?? null;
}

export function stepDurationMs(step: EscalationStep): number | null {
  return step.durationMinutes === null ? null : step.durationMinutes * 60_000;
}
