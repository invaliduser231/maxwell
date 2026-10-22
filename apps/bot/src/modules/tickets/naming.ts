export function padNumber(number: number): string {
  return String(number).padStart(4, '0');
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function cleanChannelName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 90);
}

export function ticketChannelName(
  template: string,
  vars: { panel: string; number: number; user: string },
): string {
  const filled = fillTemplate(template, {
    panel: vars.panel,
    number: padNumber(vars.number),
    user: vars.user,
  });
  return cleanChannelName(filled) || `ticket-${padNumber(vars.number)}`;
}

export function cannedName(content: string, prefix: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const name = trimmed.slice(prefix.length).trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(name) ? name : null;
}
