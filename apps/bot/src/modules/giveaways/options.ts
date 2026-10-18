export interface StartOptions {
  requiredRoleId?: string;
  excludedRoleId?: string;
  pingRoleId?: string;
  minLevel?: number;
  minMemberDays?: number;
  dmWinners?: boolean;
}

export type OptionsResult =
  | { ok: true; prize: string; options: StartOptions }
  | { ok: false; flag: string };

const ROLE = /^(?:<@&(\d{15,21})>|(\d{15,21}))$/;
const roleFlags = { role: 'requiredRoleId', not: 'excludedRoleId', ping: 'pingRoleId' } as const;
const numberFlags = {
  level: { key: 'minLevel', max: 1000 },
  days: { key: 'minMemberDays', max: 3650 },
} as const;

export function parseStartOptions(input: string): OptionsResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const prize: string[] = [];
  const options: StartOptions = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (!token.startsWith('--')) {
      prize.push(token);
      continue;
    }
    const flag = token.slice(2).toLowerCase();
    if (flag === 'nodm' || flag === 'no-dm') {
      options.dmWinners = false;
      continue;
    }
    const value = tokens[i + 1];
    if (flag in roleFlags) {
      const match = value ? ROLE.exec(value) : null;
      if (!match) return { ok: false, flag };
      options[roleFlags[flag as keyof typeof roleFlags]] = (match[1] ?? match[2]) as string;
      i++;
      continue;
    }
    if (flag in numberFlags) {
      const spec = numberFlags[flag as keyof typeof numberFlags];
      const number = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!Number.isInteger(number) || number > spec.max) return { ok: false, flag };
      options[spec.key] = number;
      i++;
      continue;
    }
    return { ok: false, flag };
  }
  return { ok: true, prize: prize.join(' '), options };
}
