import { getClient, MarketRepository } from '@data-module/db';

export interface ArchiveOptions {
  resolvedDays?: number;
  closedDays?: number;
  dryRun?: boolean;
}

/**
 * Archive old markets
 */
export async function runArchive(options: ArchiveOptions = {}): Promise<void> {
  const { resolvedDays = 30, closedDays = 14, dryRun = false } = options;

  const prisma = getClient();
  const marketRepo = new MarketRepository(prisma);

  console.log('Archive settings:');
  console.log(`  - Resolved markets older than ${resolvedDays} days`);
  console.log(`  - Closed markets older than ${closedDays} days`);
  console.log(`  - Dry run: ${dryRun}`);

  if (dryRun) {
    // Count what would be archived
    const now = new Date();
    const resolvedCutoff = new Date(now.getTime() - resolvedDays * 24 * 60 * 60 * 1000);
    const closedCutoff = new Date(now.getTime() - closedDays * 24 * 60 * 60 * 1000);

    const wouldArchive = await prisma.market.count({
      where: {
        status: { not: 'archived' },
        OR: [
          {
            status: 'resolved',
            updatedAt: { lt: resolvedCutoff },
          },
          {
            status: 'closed',
            closeTime: { lt: closedCutoff },
          },
        ],
      },
    });

    console.log(`Would archive ${wouldArchive} markets`);
    return;
  }

  const result = await marketRepo.archiveOldMarkets(resolvedDays, closedDays);

  console.log(`Archived ${result.archived} markets`);
}
