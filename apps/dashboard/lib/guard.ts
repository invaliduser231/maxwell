import 'server-only';
import { type GuildAccess, guildAccess, levelOf, voteBlocked } from './access';

export type Guarded = { access: GuildAccess } | { error: string };

export async function editor(guildId: string, module: string): Promise<Guarded> {
  if (!/^\d{1,21}$/.test(guildId)) return { error: 'Unknown community.' };
  const access = await guildAccess(guildId);
  if (!access) return { error: 'You have no access to this community.' };
  if (levelOf(access, module) !== 'edit') return { error: 'You can only look at this page.' };
  if (voteBlocked(access, module)) return { error: 'Vote on fluxerlist to change this module.' };
  return { access };
}

export async function viewer(guildId: string, module: string | null): Promise<Guarded> {
  if (!/^\d{1,21}$/.test(guildId)) return { error: 'Unknown community.' };
  const access = await guildAccess(guildId);
  if (!access || levelOf(access, module) === 'none') {
    return { error: 'You have no access to this community.' };
  }
  return { access };
}

export async function admin(guildId: string): Promise<Guarded> {
  if (!/^\d{1,21}$/.test(guildId)) return { error: 'Unknown community.' };
  const access = await guildAccess(guildId);
  if (!access?.admin) return { error: 'Only admins can do that.' };
  return { access };
}
