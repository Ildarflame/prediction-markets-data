import type { PrismaClient, IngestionState, IngestionRun, Venue } from '@prisma/client';
import type { IngestionStats } from '@data-module/core';

export interface StartRunResult {
  runId: number;
}

/**
 * Repository for ingestion state and run tracking
 */
export class IngestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get or create ingestion state for a job
   */
  async getOrCreateState(venue: Venue, jobName: string): Promise<IngestionState> {
    return this.prisma.ingestionState.upsert({
      where: {
        venue_jobName: {
          venue,
          jobName,
        },
      },
      create: {
        venue,
        jobName,
      },
      update: {},
    });
  }

  /**
   * Update ingestion state cursor
   */
  async updateCursor(
    venue: Venue,
    jobName: string,
    cursor: string | null
  ): Promise<void> {
    await this.prisma.ingestionState.update({
      where: {
        venue_jobName: {
          venue,
          jobName,
        },
      },
      data: {
        cursor,
      },
    });
  }

  /**
   * Update ingestion state watermark
   */
  async updateWatermark(
    venue: Venue,
    jobName: string,
    watermarkTs: Date
  ): Promise<void> {
    await this.prisma.ingestionState.update({
      where: {
        venue_jobName: {
          venue,
          jobName,
        },
      },
      data: {
        watermarkTs,
      },
    });
  }

  /**
   * Mark job as successful
   */
  async markSuccess(
    venue: Venue,
    jobName: string,
    stats?: IngestionStats
  ): Promise<void> {
    await this.prisma.ingestionState.update({
      where: {
        venue_jobName: {
          venue,
          jobName,
        },
      },
      data: {
        lastSuccessAt: new Date(),
        lastError: null,
        statsJson: stats as object,
      },
    });
  }

  /**
   * Mark job as failed
   */
  async markError(
    venue: Venue,
    jobName: string,
    error: string
  ): Promise<void> {
    await this.prisma.ingestionState.update({
      where: {
        venue_jobName: {
          venue,
          jobName,
        },
      },
      data: {
        lastError: error,
      },
    });
  }

  /**
   * Start a new ingestion run
   */
  async startRun(venue: Venue): Promise<StartRunResult> {
    const run = await this.prisma.ingestionRun.create({
      data: {
        venue,
        startedAt: new Date(),
      },
    });
    return { runId: run.id };
  }

  /**
   * Complete an ingestion run successfully
   */
  async completeRun(
    runId: number,
    fetchedCounts: Record<string, number>,
    writtenCounts: Record<string, number>,
    warnings?: string[]
  ): Promise<void> {
    await this.prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        ok: true,
        fetchedCounts: fetchedCounts as object,
        writtenCounts: writtenCounts as object,
        warningsJson: warnings ? (warnings as unknown as object) : undefined,
      },
    });
  }

  /**
   * Fail an ingestion run
   */
  async failRun(
    runId: number,
    error: string,
    fetchedCounts?: Record<string, number>,
    writtenCounts?: Record<string, number>
  ): Promise<void> {
    await this.prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        ok: false,
        errorText: error,
        fetchedCounts: fetchedCounts as object,
        writtenCounts: writtenCounts as object,
      },
    });
  }

  /**
   * Get recent runs for a venue
   */
  async getRecentRuns(venue: Venue, limit = 10): Promise<IngestionRun[]> {
    return this.prisma.ingestionRun.findMany({
      where: { venue },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get ingestion state for all jobs of a venue
   */
  async getStates(venue: Venue): Promise<IngestionState[]> {
    return this.prisma.ingestionState.findMany({
      where: { venue },
    });
  }

  /**
   * Get all ingestion states (all venues/jobs)
   */
  async getAllStates(): Promise<IngestionState[]> {
    return this.prisma.ingestionState.findMany({
      orderBy: [{ venue: 'asc' }, { jobName: 'asc' }],
    });
  }

  // ============================================================
  // v2.6.2: Ingestion diagnostics
  // ============================================================

  /**
   * Get recent runs for a venue with extended info (v2.6.2)
   */
  async getRecentRunsDetailed(venue: Venue, limit = 20): Promise<IngestionRun[]> {
    return this.prisma.ingestionRun.findMany({
      where: { venue },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Count consecutive failures from the most recent runs (v2.6.2)
   * Returns the number of failed runs in a row starting from the most recent
   */
  async countConsecutiveFailures(venue: Venue, jobName: string = 'markets'): Promise<number> {
    const recentRuns = await this.prisma.ingestionRun.findMany({
      where: { venue, jobName },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { ok: true },
    });

    let failures = 0;
    for (const run of recentRuns) {
      if (!run.ok) {
        failures++;
      } else {
        break; // Stop at first success
      }
    }
    return failures;
  }

  /**
   * Get error category counts from recent runs (v2.6.2)
   * Groups errors by type: 429, 5xx, timeout, network, other
   */
  async getErrorCategories(venue: Venue, limit = 50): Promise<Record<string, number>> {
    const recentRuns = await this.prisma.ingestionRun.findMany({
      where: { venue, ok: false },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { errorText: true },
    });

    const categories: Record<string, number> = {
      '429_rate_limit': 0,
      '5xx_server': 0,
      'timeout': 0,
      'network': 0,
      'prisma_db': 0,
      'parse_error': 0,
      'other': 0,
    };

    for (const run of recentRuns) {
      const error = run.errorText?.toLowerCase() || '';

      if (error.includes('429') || error.includes('rate limit') || error.includes('too many')) {
        categories['429_rate_limit']++;
      } else if (error.includes('500') || error.includes('502') || error.includes('503') || error.includes('504') || error.includes('internal server')) {
        categories['5xx_server']++;
      } else if (error.includes('timeout') || error.includes('timed out') || error.includes('etimedout')) {
        categories['timeout']++;
      } else if (error.includes('econnrefused') || error.includes('enotfound') || error.includes('network') || error.includes('fetch failed')) {
        categories['network']++;
      } else if (error.includes('prisma') || error.includes('database') || error.includes('db')) {
        categories['prisma_db']++;
      } else if (error.includes('parse') || error.includes('json') || error.includes('syntax')) {
        categories['parse_error']++;
      } else if (error) {
        categories['other']++;
      }
    }

    return categories;
  }

  /**
   * Get last successful run timestamp (v2.6.2)
   */
  async getLastSuccessfulRun(venue: Venue, jobName: string = 'markets'): Promise<IngestionRun | null> {
    return this.prisma.ingestionRun.findFirst({
      where: { venue, jobName, ok: true },
      orderBy: { finishedAt: 'desc' },
    });
  }
}
