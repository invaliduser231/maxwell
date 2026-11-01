import type { ShieldSource } from '@maxwell/core/modules/security';
import type { Key } from '@/lib/i18n';

export const sourceLabels: Record<ShieldSource, Key> = {
  raid: 'Raid',
  nuke: 'Nuke',
  severe: 'Very high risk',
  honeypot: 'Honeypot',
  manual: 'Shared by a moderator',
};
