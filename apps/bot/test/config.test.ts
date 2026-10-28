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

  it('still rejects a missing token', () => {
    expect(() => loadConfig({ FLUXER_TOKEN: '', DATABASE_URL: 'postgres://x' })).toThrow(
      /FLUXER_TOKEN/,
    );
  });
});
