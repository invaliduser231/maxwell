'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor } from '@/lib/guard';

const KEY = 'card-background';
const MAX_BYTES = 1_000_000;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function uploadBackground(
  guildId: string,
  form: FormData,
): Promise<Result<{ version: number }>> {
  const check = await editor(guildId, 'cards');
  if ('error' in check) return { ok: false, error: check.error };
  const file = form.get('image');
  if (!(file instanceof Blob)) return { ok: false, error: 'Pick an image.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'Use an image under 1 MB.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type || !TYPES.has(type)) return { ok: false, error: 'Use a PNG, JPEG or WebP image.' };
  const { sql, audit } = db();
  const [row] = await sql.begin(async (tx) => {
    await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
    return tx<{ updatedAt: Date }[]>`
      insert into guild_assets (guild_id, key, content_type, data)
      values (${guildId}, ${KEY}, ${type}, ${Buffer.from(bytes)})
      on conflict (guild_id, key) do update
        set data = excluded.data, content_type = excluded.content_type, updated_at = now()
      returning updated_at as "updatedAt"
    `;
  });
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'cards',
    action: 'background.upload',
    summary: 'Uploaded a card background',
    after: { bytes: bytes.byteLength, type },
    undo: null,
  });
  revalidatePath(`/g/${guildId}/cards`);
  return { ok: true, data: { version: row?.updatedAt.getTime() ?? Date.now() } };
}

export async function removeBackground(guildId: string): Promise<Result> {
  const check = await editor(guildId, 'cards');
  if ('error' in check) return { ok: false, error: check.error };
  const { sql, audit } = db();
  const removed = await sql`
    delete from guild_assets where guild_id = ${guildId} and key = ${KEY} returning 1
  `;
  if (removed.length > 0) {
    await audit.record({
      guildId,
      actor: { id: check.access.user.id },
      module: 'cards',
      action: 'background.remove',
      summary: 'Removed the card background',
      undo: null,
    });
  }
  revalidatePath(`/g/${guildId}/cards`);
  return { ok: true };
}
