export interface Slot {
  runAt: Date;
  dedupeKey: string;
}

export function nextSlot(kind: string, periodMs: number, now = Date.now()): Slot {
  const slot = Math.floor(now / periodMs) + 1;
  return { runAt: new Date(slot * periodMs), dedupeKey: `${kind}:${slot}` };
}
