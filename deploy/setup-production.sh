#!/bin/bash
# Production deployment script for Data Module Sports-Only
# Server: 192.168.1.251 (user: marmok)

set -e  # Exit on error

echo "🚀 Data Module Sports-Only - Production Setup"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as correct user
if [ "$USER" != "marmok" ]; then
    echo -e "${YELLOW}Warning: Expected to run as 'marmok' user${NC}"
fi

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}Error: .env.production not found!${NC}"
    echo "Copy .env.production.example to .env.production and configure it"
    exit 1
fi

echo -e "${GREEN}✓${NC} .env.production found"

# Check if secrets directory exists
if [ ! -d secrets ]; then
    echo -e "${YELLOW}Creating secrets directory...${NC}"
    mkdir -p secrets
    chmod 700 secrets
fi

# Check if Kalshi private key exists
if [ ! -f secrets/kalshi-private-key.pem ]; then
    echo -e "${RED}Error: secrets/kalshi-private-key.pem not found!${NC}"
    echo "Place your Kalshi private key in secrets/kalshi-private-key.pem"
    exit 1
fi

echo -e "${GREEN}✓${NC} Kalshi private key found"

# Create logs and backups directories
echo -e "${YELLOW}Creating logs and backups directories...${NC}"
mkdir -p logs backups/postgres
chmod 755 logs backups

# Load environment variables
echo -e "${YELLOW}Loading environment variables...${NC}"
export $(cat .env.production | grep -v '^#' | xargs)

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}Installing pnpm...${NC}"
    npm install -g pnpm@8
fi

echo -e "${GREEN}✓${NC} pnpm installed"

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
pnpm install --frozen-lockfile

# Build packages
echo -e "${YELLOW}Building packages...${NC}"
pnpm build

echo -e "${GREEN}✓${NC} Build complete"

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker is not running!${NC}"
    echo "Start Docker and try again"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker is running"

# Start PostgreSQL first (to run migrations)
echo -e "${YELLOW}Starting PostgreSQL...${NC}"
docker compose -f docker-compose.production.yml up -d postgres

# Wait for PostgreSQL to be healthy
echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
for i in {1..30}; do
    if docker compose -f docker-compose.production.yml exec -T postgres pg_isready -U sports_user -d data_module_sports &> /dev/null; then
        echo -e "${GREEN}✓${NC} PostgreSQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: PostgreSQL failed to start${NC}"
        docker compose -f docker-compose.production.yml logs postgres
        exit 1
    fi
    sleep 2
done

# Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
pnpm --filter @data-module/db db:migrate

echo -e "${GREEN}✓${NC} Migrations complete"

# Create sports-specific indexes
echo -e "${YELLOW}Creating sports-specific indexes...${NC}"
docker compose -f docker-compose.production.yml exec -T postgres psql -U sports_user -d data_module_sports <<EOF
-- Sports-specific indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_markets_sports
  ON markets(venue, derived_topic)
  WHERE derived_topic = 'SPORTS' AND is_mve = false;

CREATE INDEX IF NOT EXISTS idx_markets_kalshi_event
  ON markets(kalshi_event_ticker)
  WHERE kalshi_event_ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_sports_close_time
  ON markets(close_time)
  WHERE derived_topic = 'SPORTS' AND status = 'open';

CREATE INDEX IF NOT EXISTS idx_market_links_sports
  ON market_links(status, score)
  WHERE status IN ('suggested', 'confirmed');

-- Watchlist performance index
CREATE INDEX IF NOT EXISTS idx_quote_watchlist_priority
  ON quote_watchlist(venue, priority DESC, last_quoted_at ASC);

EOF

echo -e "${GREEN}✓${NC} Indexes created"

# Backfill sports taxonomy (one-time)
echo -e "${YELLOW}Backfilling sports taxonomy...${NC}"
pnpm --filter @data-module/worker kalshi:taxonomy:backfill --topic SPORTS
pnpm --filter @data-module/worker polymarket:taxonomy:backfill --topic SPORTS

echo -e "${GREEN}✓${NC} Taxonomy backfilled"

# Sync Kalshi events (one-time initial sync)
echo -e "${YELLOW}Syncing Kalshi sports events...${NC}"
pnpm --filter @data-module/worker kalshi:events:smart-sync --non-mve

echo -e "${GREEN}✓${NC} Events synced"

# Populate initial watchlist
echo -e "${YELLOW}Populating watchlist with top sports markets...${NC}"
pnpm --filter @data-module/worker links:watchlist:sync

echo -e "${GREEN}✓${NC} Watchlist populated"

# Start all services
echo -e "${YELLOW}Starting all services...${NC}"
docker compose -f docker-compose.production.yml up -d

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📊 Check status:"
echo "   docker compose -f docker-compose.production.yml ps"
echo ""
echo "📋 View logs:"
echo "   docker compose -f docker-compose.production.yml logs -f worker"
echo "   docker compose -f docker-compose.production.yml logs -f ingestion-kalshi"
echo "   docker compose -f docker-compose.production.yml logs -f quotes-worker"
echo ""
echo "🔍 Monitor health:"
echo "   docker compose -f docker-compose.production.yml exec worker pnpm --filter @data-module/worker health"
echo ""
echo "🛑 Stop all services:"
echo "   docker compose -f docker-compose.production.yml down"
echo ""
echo "🔄 Restart a service:"
echo "   docker compose -f docker-compose.production.yml restart worker"
echo ""
echo "💾 Backup database:"
echo "   ./deploy/backup.sh"
echo ""
