import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const privateRanges: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

function toInt(address: string): number {
  return address.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function privateV4(address: string): boolean {
  const value = toInt(address);
  return privateRanges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (toInt(base) & mask) >>> 0;
  });
}

function privateV6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  return mapped?.[1] ? privateV4(mapped[1]) : false;
}

export function isPrivateAddress(address: string): boolean {
  return isIP(address) === 6 ? privateV6(address) : privateV4(address);
}

export async function isPublicHttps(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
