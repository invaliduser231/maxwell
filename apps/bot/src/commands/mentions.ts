const snowflake = /^\d{15,21}$/;

export function userId(input: string): string | null {
  const match = /^<@!?(\d{15,21})>$/.exec(input);
  if (match?.[1]) return match[1];
  return snowflake.test(input) ? input : null;
}

export function channelId(input: string): string | null {
  const match = /^<#(\d{15,21})>$/.exec(input);
  if (match?.[1]) return match[1];
  return snowflake.test(input) ? input : null;
}

export function roleId(input: string): string | null {
  const match = /^<@&(\d{15,21})>$/.exec(input);
  if (match?.[1]) return match[1];
  return snowflake.test(input) ? input : null;
}

export const mention = {
  user: (id: string) => `<@${id}>`,
  channel: (id: string) => `<#${id}>`,
  role: (id: string) => `<@&${id}>`,
};
