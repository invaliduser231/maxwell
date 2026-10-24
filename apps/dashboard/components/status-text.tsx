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
  if (!status) return null;
  if (status.error) {
    return (
      <span className="mx-status mx-status-error" role="status">
        {status.message}
      </span>
    );
  }
  if (status.message === SORTED) {
    return (
      <span className="mx-sorted" role="status">
        <img src="/mascot/happy.svg" alt="" width={22} height={22} />
        {status.message}
      </span>
    );
  }
  return (
    <span className="mx-status" role="status">
      {status.message}
    </span>
  );
}
