-- v1.1 Schema Updates
-- Add raw JSON for debugging, sourceUpdatedAt for incremental sync

-- Markets: add sourceUpdatedAt and statusMeta
ALTER TABLE "markets" ADD COLUMN "source_updated_at" TIMESTAMPTZ;
ALTER TABLE "markets" ADD COLUMN "status_meta" JSONB;

-- Quotes: add raw JSON
ALTER TABLE "quotes" ADD COLUMN "raw" JSONB;

-- LatestQuotes: add raw JSON
ALTER TABLE "latest_quotes" ADD COLUMN "raw" JSONB;

-- IngestionRuns: add job_name
ALTER TABLE "ingestion_runs" ADD COLUMN "job_name" VARCHAR(255) DEFAULT 'ingest';

-- Drop duplicate index (already covered by unique constraint)
DROP INDEX IF EXISTS "markets_venue_external_id_idx";

-- Update index on ingestion_runs
DROP INDEX IF EXISTS "ingestion_runs_venue_started_at_idx";
CREATE INDEX "ingestion_runs_venue_job_name_started_at_idx" ON "ingestion_runs"("venue", "job_name", "started_at" DESC);
