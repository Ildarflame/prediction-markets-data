/**
 * Rollback Manual Review Actions (v3.1.0)
 *
 * Rolls back both confirmations AND rejections from web UI
 */

import { getClient } from '@data-module/db';

export async function runReviewRollback(): Promise<void> {
  const prisma = getClient();

  console.log('\n🔄 Rolling back manual review actions...\n');

  // Rollback confirmations
  const confirmed = await prisma.marketLink.updateMany({
    where: {
      status: 'confirmed',
      reason: 'manual_review@3.1.0:web_ui',
    },
    data: {
      status: 'suggested',
      reason: null,
    },
  });

  // Rollback rejections
  const rejected = await prisma.marketLink.updateMany({
    where: {
      status: 'rejected',
      reason: 'manual_review@3.1.0:web_ui',
    },
    data: {
      status: 'suggested',
      reason: null,
    },
  });

  console.log(`✓ Rolled back ${confirmed.count} accidental confirmations`);
  console.log(`✓ Rolled back ${rejected.count} accidental rejections`);
  console.log(`Total: ${confirmed.count + rejected.count} links returned to "suggested" status\n`);
}
