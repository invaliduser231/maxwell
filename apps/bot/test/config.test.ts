import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('treats empty values like missing ones', () => {
    const config = loadConfig({
      FLUXER_TOKEN: 'token',
      DATABASE_URL: 'postgres://x',
      DASHBOARD_URL: '',
      VOTE_URL: '',
      TWITCH_CLIENT_ID: '',
      HEALTH_PORT: '',
      DEFAULT_PREFIX: '',
    });
    expect(config.DASHBOARD_URL).toBeUndefined();
    expect(config.HEALTH_PORT).toBe(8080);
    expect(config.DEFAULT_PREFIX).toBe('m!');
  });

  it('accepts an optional 32 byte data key', () => {
    const base = { FLUXER_TOKEN: 'token', DATABASE_URL: 'postgres://x' };
    expect(loadConfig({ ...base, DATA_KEY: '' }).DATA_KEY).toBeUndefined();
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({ ...base, DATA_KEY: key }).DATA_KEY).toBe(key);
    expect(() => loadConfig({ ...base, DATA_KEY: 'c2hvcnQ=' })).toThrow(/DATA_KEY/);
  });

  it('still rejects a missing token', () => {
    expect(() => loadConfig({ FLUXER_TOKEN: '', DATABASE_URL: 'postgres://x' })).toThrow(
      /FLUXER_TOKEN/,
    );
  });
});
