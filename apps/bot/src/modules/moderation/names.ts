import type { ModerationStore, NameKind } from '@maxwell/core/stores/moderation';
import type { MemberUpdate, UserRef } from '../../platform/types.js';
import { BoundedMap } from './expected.js';

interface Known {
  username: string | null;
  display: string | null;
}

export interface NameChange {
  kind: NameKind;
  value: string | null;
  previous: string | null;
  baseline: boolean;
}

export function diffNames(known: Known | null, user: UserRef): NameChange[] {
  const display = user.displayName === user.username ? null : user.displayName;
  if (!known) {
    return [
      { kind: 'username', value: user.username, previous: null, baseline: true },
      { kind: 'display', value: display, previous: null, baseline: true },
    ];
  }
  const changes: NameChange[] = [];
  if (known.username !== user.username) {
    changes.push({
      kind: 'username',
      value: user.username,
      previous: known.username,
      baseline: known.username === null,
    });
  }
  if (known.display !== display) {
    changes.push({ kind: 'display', value: display, previous: known.display, baseline: false });
  }
  return changes;
}

export class NameTracker {
  readonly #known = new BoundedMap<string, Known>(20_000);

  constructor(private readonly store: ModerationStore) {}

  async onJoin(guildId: string, user: UserRef): Promise<void> {
    await this.#track(guildId, user);
  }

  async onUpdate(update: MemberUpdate): Promise<void> {
    const { guildId, user } = update;
    if (update.before && update.before.nick !== update.nick) {
      await this.store.recordName(guildId, user.id, 'nick', update.nick, update.before.nick, false);
    }
    await this.#track(guildId, user);
  }

  forget(guildId: string, userId: string): void {
    this.#known.delete(`${guildId}:${userId}`);
  }

  async #track(guildId: string, user: UserRef): Promise<void> {
    if (user.bot) return;
    const key = `${guildId}:${user.id}`;
    let known = this.#known.get(key) ?? null;
    if (!known) {
      const [username, display] = await Promise.all([
        this.store.lastName(guildId, user.id, 'username'),
        this.store.lastName(guildId, user.id, 'display'),
      ]);
      known =
        username || display
          ? { username: username?.value ?? null, display: display?.value ?? null }
          : null;
    }
    const changes = diffNames(known, user);
    for (const change of changes) {
      await this.store.recordName(
        guildId,
        user.id,
        change.kind,
        change.value,
        change.previous,
        change.baseline,
      );
    }
    this.#known.set(key, {
      username: user.username,
      display: user.displayName === user.username ? null : user.displayName,
    });
  }
}
