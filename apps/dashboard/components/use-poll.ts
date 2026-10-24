'use client';

import { useEffect, useRef } from 'react';

export function usePoll() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (step: () => Promise<boolean>, onGiveUp?: () => void, tries = 20, every = 1500) => {
    let count = 0;
    const tick = async () => {
      count++;
      const done = await step().catch(() => false);
      if (done) return;
      if (count >= tries) {
        onGiveUp?.();
        return;
      }
      timer.current = setTimeout(tick, every);
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(tick, every);
  };
}
