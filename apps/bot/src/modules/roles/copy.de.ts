import type { MenuType } from '@maxwell/core/modules/roles';
import { formatDuration } from '../../commands/duration.js';
import { subtext } from '../../ui/format.js';
import type { RolesCopy } from './copy.js';

const de: RolesCopy = {
  menuHint(type: MenuType, minutes: number): string | null {
    switch (type) {
      case 'unique':
        return subtext('Immer nur eine Rolle.');
      case 'add':
        return subtext('Rollen bleiben, auch wenn du die Reaktion entfernst.');
      case 'temporary':
        return subtext(`Rollen gelten ${formatDuration(minutes * 60_000)}.`);
      default:
        return null;
    }
  },
};

export default de;
