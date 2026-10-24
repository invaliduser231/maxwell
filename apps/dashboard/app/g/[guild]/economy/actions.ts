'use server';

import { randomUUID } from 'node:crypto';
import { collectionConfig } from '@maxwell/core/modules/collection';
import { economyConfig } from '@maxwell/core/modules/economy';
import { z } from 'zod';
import { voteBlocked } from '@/lib/access';
import type { Result } from '@/lib/actions';
import { db } from '@/lib/db';
import { editor, viewer } from '@/lib/guard';
import { type LedgerRow, ledgerPage } from './ledger';

const IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE = 1_000_000;
const transactionId = z.string().regex(/^\d{1,19}$/);

export async function moreTransactions(
  guildId: string,
  before: string,
): Promise<Result<{ rows: LedgerRow[]; next: string | null }>> {
  const check = await viewer(guildId, 'economy');
  if ('error' in check) return { ok: false, error: check.error };
  if (voteBlocked(check.access, 'economy'))
    return { ok: false, error: 'Vote on fluxerlist to see this.' };
  if (!transactionId.safeParse(before).success) return { ok: false, error: 'Nothing more.' };
  const { modules } = db();
  const [economy, collection] = await Promise.all([
    modules.get(guildId, 'economy', economyConfig),
    modules.get(guildId, 'collection', collectionConfig),
  ]);
  return { ok: true, data: await ledgerPage(guildId, economy, collection, before) };
}

export async function uploadBackground(
  guildId: string,
  dataUrl: string,
): Promise<Result<{ key: string }>> {
  const check = await editor(guildId, 'economy');
  if ('error' in check) return { ok: false, error: check.error };
  const match = IMAGE.exec(dataUrl);
  const data = match?.[2] ? Buffer.from(match[2], 'base64') : null;
  if (!match?.[1] || !data || data.length === 0 || data.length > MAX_IMAGE) {
    return { ok: false, error: 'Use a PNG, JPEG or WebP under 1 MB.' };
  }
  const key = `shop-bg-${randomUUID().slice(0, 12)}`;
  const { sql, audit } = db();
  await sql.begin(async (tx) => {
    await tx`insert into guilds (id) values (${guildId}) on conflict (id) do nothing`;
    await tx`
      insert into guild_assets (guild_id, key, content_type, data)
      values (${guildId}, ${key}, ${match[1] as string}, ${data})
    `;
  });
  await audit.record({
    guildId,
    actor: { id: check.access.user.id },
    module: 'economy',
    action: 'shop.background',
    summary: 'Uploaded a profile background',
    after: { key },
    undo: null,
  });
  return { ok: true, data: { key } };
}
