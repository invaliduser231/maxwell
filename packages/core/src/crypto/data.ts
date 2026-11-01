import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export const DATA_PREFIX = 'enc:v1:';

const SALT = 'maxwell-data';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CACHE_LIMIT = 10_000;
const SEALED = /^enc:v1:[A-Za-z0-9+/]+={0,2}$/;

export class DataKeyError extends Error {}

export function parseDataKey(value: string): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.trim()) {
    throw new DataKeyError('DATA_KEY must be 32 bytes encoded as base64');
  }
  return key;
}

export function isValidDataKey(value: string): boolean {
  try {
    parseDataKey(value);
    return true;
  } catch {
    return false;
  }
}

export function deriveGuildKey(master: Buffer, guildId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, SALT, `maxwell:data:v1:guild:${guildId}`, 32));
}

export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && SEALED.test(value);
}

export function encryptValue(key: Buffer, plain: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${DATA_PREFIX}${Buffer.concat([nonce, data, cipher.getAuthTag()]).toString('base64')}`;
}

export function decryptValue(key: Buffer, value: string): string {
  if (!isSealed(value)) return value;
  const raw = Buffer.from(value.slice(DATA_PREFIX.length), 'base64');
  if (raw.length < NONCE_BYTES + TAG_BYTES) throw new DataKeyError('sealed value is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, NONCE_BYTES));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DataKeyError('sealed value could not be decrypted');
  }
}

export class DataCipher {
  readonly #master: Buffer | null;
  readonly #keys = new Map<string, Buffer>();

  constructor(master: Buffer | null) {
    this.#master = master;
  }

  static from(value: string | null | undefined): DataCipher {
    return new DataCipher(value ? parseDataKey(value) : null);
  }

  get enabled(): boolean {
    return this.#master !== null;
  }

  #key(guildId: string): Buffer {
    if (!this.#master) throw new DataKeyError('DATA_KEY is not set');
    let key = this.#keys.get(guildId);
    if (!key) {
      if (this.#keys.size >= CACHE_LIMIT) this.#keys.clear();
      key = deriveGuildKey(this.#master, guildId);
      this.#keys.set(guildId, key);
    }
    return key;
  }

  encrypt(guildId: string, plain: string): string {
    if (!this.#master || isSealed(plain)) return plain;
    return encryptValue(this.#key(guildId), plain);
  }

  decrypt(guildId: string, value: string): string {
    if (!isSealed(value)) return value;
    return decryptValue(this.#key(guildId), value);
  }
}

let current: DataCipher | null = null;
let failed = false;
let reporter: (error: unknown) => void = () => {};

export function configureDataKey(value: string | null | undefined): DataCipher {
  current = DataCipher.from(value);
  failed = false;
  return current;
}

export function dataCipher(): DataCipher {
  if (!current) current = DataCipher.from(process.env.DATA_KEY || null);
  return current;
}

export function onDataKeyError(handler: (error: unknown) => void): void {
  reporter = handler;
  failed = false;
}

export function sealText(guildId: string, value: string): string;
export function sealText(guildId: string, value: string | null): string | null;
export function sealText(guildId: string, value: string | null | undefined): string | null;
export function sealText(guildId: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return dataCipher().encrypt(guildId, value);
}

export function openText(guildId: string, value: string): string;
export function openText(guildId: string, value: string | null): string | null;
export function openText(guildId: string, value: string | null | undefined): string | null;
export function openText(guildId: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isSealed(value)) return value;
  try {
    return dataCipher().decrypt(guildId, value);
  } catch (error) {
    if (!failed) {
      failed = true;
      reporter(error);
    }
    return value;
  }
}

export function sealJson(guildId: string, value: unknown): unknown {
  if (!dataCipher().enabled || value === null || value === undefined || isSealed(value)) {
    return value;
  }
  return dataCipher().encrypt(guildId, JSON.stringify(value));
}

export function openJson<T>(guildId: string, value: unknown, fallback: T): T {
  if (!isSealed(value)) return value as T;
  const plain = openText(guildId, value);
  if (isSealed(plain)) return fallback;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return fallback;
  }
}
