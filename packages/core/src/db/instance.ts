import type { Sql } from './sql.js';

export interface InstanceLock {
  release(): Promise<void>;
}

export interface LockOptions {
  retryMs?: number;
  onWait?: (attempt: number) => void;
  signal?: AbortSignal;
}

export async function holdInstanceLock(
  sql: Sql,
  name: string,
  options: LockOptions = {},
): Promise<InstanceLock> {
  const retryMs = options.retryMs ?? 5_000;
  const reserved = await sql.reserve();
  let attempt = 0;
  while (!options.signal?.aborted) {
    const [row] = await reserved<{ ok: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${name})) as ok
    `;
    if (row?.ok) {
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          await reserved`select pg_advisory_unlock(hashtext(${name}))`.catch(() => undefined);
          reserved.release();
        },
      };
    }
    options.onWait?.(attempt++);
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  reserved.release();
  throw new Error('instance lock wait aborted');
}
