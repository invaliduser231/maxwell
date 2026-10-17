import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const token = process.env.FLUXER_TOKEN;
const api = `${process.env.FLUXER_API ?? 'https://api.fluxer.app'}/v1`;
const guildId = process.argv[2];
const envFile = join(import.meta.dirname, '..', '.env');
const png = join(import.meta.dirname, '..', 'assets', 'png');

if (!token) throw new Error('FLUXER_TOKEN is not set');

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (;;) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429) {
      const { retry_after } = (await response.json()) as { retry_after?: number };
      await new Promise((resolve) => setTimeout(resolve, ((retry_after ?? 1) + 0.25) * 1000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

if (!guildId) {
  const guilds = await call<{ id: string; name: string }[]>('GET', '/users/@me/guilds');
  for (const guild of guilds) console.log(`${guild.id}  ${guild.name}`);
  console.log('\nRun again with the id of the asset community.');
  process.exit(0);
}

const files = ['icons', 'emoji'].flatMap((group) =>
  readdirSync(join(png, group))
    .filter((file) => file.endsWith('.png'))
    .map((file) => ({ key: basename(file, '.png'), path: join(png, group, file) })),
);

const replace = new Set(process.argv.slice(3));
const existing = await call<{ id: string; name: string }[]>('GET', `/guilds/${guildId}/emojis`);
const ids = new Map(existing.map((emoji) => [emoji.name, emoji.id]));

for (const file of files) {
  const name = `mx_${file.key}`;
  const old = ids.get(name);
  if (old && (replace.has(file.key) || replace.has('all'))) {
    await call('DELETE', `/guilds/${guildId}/emojis/${old}`).catch(() => {});
    ids.delete(name);
    console.log(`removed  ${name}`);
  }
  if (ids.has(name)) {
    console.log(`kept     ${name}`);
    continue;
  }
  const image = `data:image/png;base64,${readFileSync(file.path).toString('base64')}`;
  const created = await call<{ id: string }>('POST', `/guilds/${guildId}/emojis`, { name, image });
  ids.set(name, created.id);
  console.log(`uploaded ${name}`);
}

const line = `ICON_EMOJIS=${files
  .map((file) => `${file.key}=${ids.get(`mx_${file.key}`)}`)
  .join(',')}`;

const env = readFileSync(envFile, 'utf8');
const next = /^ICON_EMOJIS=.*$/m.test(env)
  ? env.replace(/^ICON_EMOJIS=.*$/m, line)
  : `${env.trimEnd()}\n${line}\n`;
writeFileSync(envFile, next);
console.log(`\n.env updated with ${files.length} icons`);
