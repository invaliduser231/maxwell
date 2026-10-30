import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const core = require.resolve('@fluxerjs/core');
const wsEntry = createRequire(core).resolve('@fluxerjs/ws');

type Listener = (event: unknown) => void;

class ClosingSocket {
  static last: ClosingSocket | null = null;
  readyState = 0;
  readonly #listeners = new Map<string, Listener[]>();

  constructor() {
    ClosingSocket.last = this;
  }

  addEventListener(type: string, listener: Listener): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  fire(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener({});
  }

  close(): void {
    this.readyState = 3;
    this.fire('error');
  }

  send(): void {}
}

describe('gateway socket errors', () => {
  it('does not loop when closing a failed socket raises another error', async () => {
    const { WebSocketShard } = (await import(pathToFileURL(wsEntry).href)) as {
      WebSocketShard: new (
        options: Record<string, unknown>,
      ) => {
        on(event: string, listener: () => void): void;
        connect(): void;
        destroy(): void;
      };
    };
    const shard = new WebSocketShard({
      token: 'token',
      intents: 0,
      url: 'wss://gateway.invalid',
      shardId: 0,
      numShards: 1,
      WebSocket: ClosingSocket,
      debug: false,
    });
    let errors = 0;
    shard.on('error', () => {
      errors++;
    });
    shard.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ClosingSocket.last).not.toBeNull();
    ClosingSocket.last?.fire('error');
    shard.destroy();
    expect(errors).toBeLessThanOrEqual(2);
  });
});
