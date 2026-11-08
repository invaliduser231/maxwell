import type { MenuType } from '@maxwell/core/modules/roles';
import { formatDuration } from '../../commands/duration.js';
import { subtext } from '../../ui/format.js';
import type { RolesCopy } from './copy.js';

const es: RolesCopy = {
  menuHint(type: MenuType, minutes: number, limit = 1): string | null {
    switch (type) {
      case 'unique':
        return subtext('Un rol a la vez.');
      case 'add':
        return subtext('Los roles se quedan aunque quites la reacción.');
      case 'temporary':
        return subtext(`Los roles duran ${formatDuration(minutes * 60_000)}.`);
      case 'verify':
        return subtext('Reacciona para obtener el rol.');
      case 'remove':
        return subtext('Reacciona para quitarte el rol.');
      case 'binding':
        return subtext('Elige una vez. La elección es definitiva.');
      case 'limit':
        return subtext(limit === 1 ? 'Hasta 1 rol.' : `Hasta ${limit} roles.`);
      default:
        return null;
    }
  },
};

export default es;
