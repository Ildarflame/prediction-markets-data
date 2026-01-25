/**
 * Rollback Manual Review Confirmations (v3.1.0)
 */

import { getClient } from '@data-module/db';

export async function runReviewRollback(): Promise<void> {
  const prisma = getClient();

  console.log('\n🔄 Rolling back manual review confirmations...\n');

  const result = await prisma.marketLink.updateMany({
    where: {
      status: 'confirmed',
      reason: 'manual_review@3.1.0:web_ui',
    },
    data: {
      status: 'suggested',
      reason: null,
    },
  });

  console.log(`✓ Rolled back ${result.count} accidental confirmations`);
  console.log('All links returned to "suggested" status\n');
}
