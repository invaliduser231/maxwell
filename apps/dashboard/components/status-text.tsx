import { useT } from './i18n';

export const SORTED = 'Sorted.';

export type Status = { message: string; error: boolean } | null;

export function sorted(message = SORTED): Status {
  return { message, error: false };
}

export function failed(message: string): Status {
  return { message, error: true };
}

export function outcome(
  result: { ok: true } | { ok: false; error: string },
  done = SORTED,
): Status {
  return result.ok ? sorted(done) : failed(result.error);
}

export function StatusText({ status }: { status: Status }) {
  const t = useT();
  if (!status) return null;
  const message = t.raw(status.message);
  if (status.error) {
    return (
      <span className="mx-status mx-status-error" role="status">
        {message}
      </span>
    );
  }
  if (status.message === SORTED) {
    return (
      <span className="mx-sorted" role="status">
        <img src="/mascot/happy.svg" alt="" width={22} height={22} />
        {message}
      </span>
    );
  }
  return (
    <span className="mx-status" role="status">
      {message}
    </span>
  );
}
