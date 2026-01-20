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
}
