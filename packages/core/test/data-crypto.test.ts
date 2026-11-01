import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureDataKey,
  DATA_PREFIX,
  DataCipher,
  DataKeyError,
  isSealed,
  isValidDataKey,
  onDataKeyError,
  openJson,
  openText,
  parseDataKey,
  sealJson,
  sealText,
} from '../src/crypto/data.js';

const key = randomBytes(32).toString('base64');
const guild = '900000000000000001';
const other = '900000000000000002';

describe('data cipher', () => {
  afterEach(() => {
    configureDataKey(process.env.DATA_KEY || null);
    onDataKeyError(() => {});
  });

  it('round trips text per guild with a fresh nonce', () => {
    const cipher = DataCipher.from(key);
    const first = cipher.encrypt(guild, 'posted a scam link');
    const second = cipher.encrypt(guild, 'posted a scam link');
    expect(first.startsWith(DATA_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(cipher.decrypt(guild, first)).toBe('posted a scam link');
    expect(cipher.decrypt(guild, cipher.encrypt(guild, ''))).toBe('');
    expect(cipher.decrypt(guild, cipher.encrypt(guild, 'Grüße aus Fürth'))).toBe('Grüße aus Fürth');
  });

  it('fails with the key of another guild', () => {
    const cipher = DataCipher.from(key);
    const sealed = cipher.encrypt(guild, 'secret');
    expect(() => cipher.decrypt(other, sealed)).toThrow(DataKeyError);
  });

  it('fails with another master key', () => {
    const sealed = DataCipher.from(key).encrypt(guild, 'secret');
    const stranger = DataCipher.from(randomBytes(32).toString('base64'));
    expect(() => stranger.decrypt(guild, sealed)).toThrow(DataKeyError);
  });

  it('passes legacy plaintext through', () => {
    const cipher = DataCipher.from(key);
    expect(cipher.decrypt(guild, 'plain reason')).toBe('plain reason');
    expect(isSealed('plain reason')).toBe(false);
  });

  it('detects tampering', () => {
    const cipher = DataCipher.from(key);
    const sealed = cipher.encrypt(guild, 'evidence');
    const raw = Buffer.from(sealed.slice(DATA_PREFIX.length), 'base64');
    for (const index of [0, 14, raw.length - 1]) {
      const copy = Buffer.from(raw);
      copy[index] = (copy[index] ?? 0) ^ 1;
      expect(() => cipher.decrypt(guild, `${DATA_PREFIX}${copy.toString('base64')}`)).toThrow(
        DataKeyError,
      );
    }
    expect(() => cipher.decrypt(guild, `${DATA_PREFIX}AAAA`)).toThrow(DataKeyError);
  });

  it('validates the master key', () => {
    expect(isValidDataKey(key)).toBe(true);
    expect(isValidDataKey(randomBytes(16).toString('base64'))).toBe(false);
    expect(isValidDataKey('not a key')).toBe(false);
    expect(() => parseDataKey('')).toThrow(DataKeyError);
  });

  it('stores plaintext without a key', () => {
    configureDataKey(null);
    expect(sealText(guild, 'note')).toBe('note');
    expect(sealText(guild, null)).toBeNull();
    expect(sealJson(guild, [{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('seals text and json with the configured key', () => {
    configureDataKey(key);
    const text = sealText(guild, 'note');
    expect(isSealed(text)).toBe(true);
    expect(openText(guild, text)).toBe('note');
    expect(sealText(guild, text)).toBe(text);
    const json = sealJson(guild, [{ question: 'Age', answer: '19' }]);
    expect(isSealed(json)).toBe(true);
    expect(openJson(guild, json, [])).toEqual([{ question: 'Age', answer: '19' }]);
    expect(openJson(guild, [{ legacy: true }], [])).toEqual([{ legacy: true }]);
  });

  it('reports a failed decryption once and keeps the stored value', () => {
    configureDataKey(key);
    const sealed = sealText(guild, 'note');
    configureDataKey(randomBytes(32).toString('base64'));
    const report = vi.fn();
    onDataKeyError(report);
    expect(openText(guild, sealed)).toBe(sealed);
    expect(openText(guild, sealed)).toBe(sealed);
    expect(openJson(guild, sealed, ['fallback'])).toEqual(['fallback']);
    expect(report).toHaveBeenCalledTimes(1);
    configureDataKey(null);
    expect(openText(guild, sealed)).toBe(sealed);
  });
});
