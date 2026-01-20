-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('suggested', 'confirmed', 'rejected');

-- CreateTable
CREATE TABLE "market_links" (
    "id" SERIAL NOT NULL,
    "left_venue" "Venue" NOT NULL,
    "left_market_id" INTEGER NOT NULL,
    "right_venue" "Venue" NOT NULL,
    "right_market_id" INTEGER NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'suggested',
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "market_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_links_status_score_idx" ON "market_links"("status", "score" DESC);

-- CreateIndex
CREATE INDEX "market_links_left_venue_right_venue_idx" ON "market_links"("left_venue", "right_venue");

-- CreateIndex
CREATE UNIQUE INDEX "market_links_left_venue_left_market_id_right_venue_right_ma_key" ON "market_links"("left_venue", "left_market_id", "right_venue", "right_market_id");

-- AddForeignKey
ALTER TABLE "market_links" ADD CONSTRAINT "market_links_left_market_id_fkey" FOREIGN KEY ("left_market_id") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_links" ADD CONSTRAINT "market_links_right_market_id_fkey" FOREIGN KEY ("right_market_id") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
