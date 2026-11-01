import type { securityConfig } from '@maxwell/core/modules/security';
import { ShieldDisputeStore } from '@maxwell/core/stores/shield-disputes';
import { z } from 'zod';
import type { ModuleContext } from '../../runtime/module.js';
import { lines } from '../../ui/format.js';
import { disputeCopy } from './dispute-copy.js';

const notifyPayload = z.object({ id: z.string().regex(/^\d{1,19}$/) });

export function disputeMessage(
  status: 'removed' | 'kept',
  note: string | null,
  dashboard: string | undefined,
): string {
  const base = dashboard?.replace(/\/+$/, '');
  return lines(
    status === 'removed' ? disputeCopy.removed : disputeCopy.kept,
    note ? disputeCopy.note(note) : null,
    base ? disputeCopy.link(`${base}/shield`) : null,
  );
}

export function registerDisputes(ctx: ModuleContext<typeof securityConfig>): void {
  const { services } = ctx;
  const store = new ShieldDisputeStore(services.sql);

  ctx.job('shield.dispute.notify', async (job) => {
    const parsed = notifyPayload.safeParse(job.payload);
    if (!parsed.success) return;
    const dispute = await store.get(parsed.data.id);
    if (!dispute || dispute.status === 'open') return;
    const text = disputeMessage(dispute.status, dispute.note, services.config.DASHBOARD_URL);
    await services.platform.sendDirect(dispute.userId, text).catch(() => false);
  });
}
