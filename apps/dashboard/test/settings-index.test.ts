import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { areas } from '../lib/i18n/messages';
import { indexFile, scanSettings } from '../lib/settings-scan';

describe('settings index', () => {
  it('matches the labels in the pages', () => {
    const stored = JSON.parse(readFileSync(indexFile, 'utf8'));
    assert.deepEqual(
      stored,
      scanSettings(),
      'run pnpm --filter @maxwell/dashboard settings-index to refresh it',
    );
  });

  it('only holds texts the English files know', async () => {
    const known = new Set<string>();
    for (const area of areas) {
      const table = (await import(`../locales/en/${area}.json`, { with: { type: 'json' } }))
        .default;
      for (const key of Object.keys(table)) known.add(key);
    }
    const missing = scanSettings().filter((entry) => !known.has(entry.label));
    assert.deepEqual(missing, []);
  });
});
