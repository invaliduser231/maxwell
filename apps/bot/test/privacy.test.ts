import { describe, expect, it } from 'vitest';
import { PrivacyRegistry } from '../src/runtime/privacy.js';

describe('PrivacyRegistry', () => {
  it('collects exports per module and skips empty ones', async () => {
    const registry = new PrivacyRegistry();
    registry.register('levels', { export: async () => ({ xp: 120 }) });
    registry.register('economy', { export: async () => null });
    registry.register('notes', { export: async () => ({}) });
    const { data, failed } = await registry.export('1', '2');
    expect(data).toEqual({ levels: { xp: 120 } });
    expect(failed).toEqual([]);
  });

  it('keeps going when one module fails and reports it', async () => {
    const registry = new PrivacyRegistry();
    const forgotten: string[] = [];
    registry.register('broken', {
      forget: async () => {
        throw new Error('db down');
      },
    });
    registry.register('levels', {
      forget: async (guildId, userId) => {
        forgotten.push(`${guildId}:${userId}`);
      },
    });
    const failed = await registry.forget('1', '2');
    expect(failed).toEqual([{ module: 'broken', error: 'db down' }]);
    expect(forgotten).toEqual(['1:2']);
  });

  it('refuses a second handler for the same module', () => {
    const registry = new PrivacyRegistry();
    registry.register('levels', {});
    expect(() => registry.register('levels', {})).toThrow('duplicate privacy handler');
  });
});
