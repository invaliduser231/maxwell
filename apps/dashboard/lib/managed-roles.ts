export interface BotHolder {
  username: string;
  globalName: string | null;
  roleIds: readonly string[];
}

function simple(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function managedRoleIds(
  roles: readonly { id: string; name: string }[],
  bots: readonly BotHolder[],
): Set<string> {
  const managed = new Set<string>();
  for (const role of roles) {
    const name = simple(role.name);
    if (!name) continue;
    const owned = bots.some(
      (bot) =>
        bot.roleIds.includes(role.id) &&
        (simple(bot.username) === name ||
          (bot.globalName !== null && simple(bot.globalName) === name)),
    );
    if (owned) managed.add(role.id);
  }
  return managed;
}
