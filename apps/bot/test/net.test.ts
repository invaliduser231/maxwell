import { describe, expect, it } from 'vitest';
import { luminance, readableOnDark } from '../src/cards/theme.js';
import { isPrivateAddress, isPublicHttps } from '../src/net.js';

describe('isPrivateAddress', () => {
  it.each([
    '10.20.0.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fd00::1',
    '::ffff:10.0.0.1',
  ])('%s is private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '65.109.123.29', '2a01:4f8::1'])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('isPublicHttps', () => {
  it('rejects plain http, localhost and private literals', async () => {
    expect(await isPublicHttps('http://example.com/a.png')).toBe(false);
    expect(await isPublicHttps('https://localhost/a.png')).toBe(false);
    expect(await isPublicHttps('https://10.20.0.15/a.png')).toBe(false);
    expect(await isPublicHttps('not a url')).toBe(false);
  });
});

describe('card colors', () => {
  it('accepts bright accents and rejects ones that vanish on the dark card', () => {
    expect(readableOnDark('#F26B3A')).toBe(true);
    expect(readableOnDark('#3A9EEA')).toBe(true);
    expect(readableOnDark('#17171B')).toBe(false);
    expect(readableOnDark('#2B2B33')).toBe(false);
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
  });
});
