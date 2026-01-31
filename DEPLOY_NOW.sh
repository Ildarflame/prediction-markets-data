#!/bin/bash
# ONE-CLICK DEPLOYMENT to 192.168.1.251
# Sports-Only Mode with Web UI

set -e

echo "🚀 Data Module Sports - ONE-CLICK DEPLOYMENT"
echo "=============================================="
echo ""
echo "Server: 192.168.1.251"
echo "User: marmok"
echo "Web UI: http://192.168.1.251:3000"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Pre-flight checks
echo -e "${BLUE}Pre-flight checks...${NC}"

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ .env.production not found!${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} .env.production exists"

# Check if Kalshi private key exists
if [ ! -f secrets/kalshi-private-key.pem ]; then
    echo -e "${RED}❌ secrets/kalshi-private-key.pem not found!${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Kalshi credentials exist"

# Check SSH connection
echo -e "${YELLOW}Testing SSH connection to marmok@192.168.1.251...${NC}"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=no marmok@192.168.1.251 "echo 'Connected'" &> /dev/null; then
    echo -e "${RED}❌ Cannot connect to server${NC}"
    echo "Trying with password authentication..."
    if ! ssh -o ConnectTimeout=5 marmok@192.168.1.251 "echo 'Connected'" &> /dev/null; then
        echo -e "${RED}❌ SSH connection failed${NC}"
        echo "Please check:"
        echo "1. Server is online (192.168.1.251)"
        echo "2. SSH is enabled"
        echo "3. Password is correct (gimgimlil)"
        exit 1
    fi
fi
echo -e "${GREEN}✓${NC} SSH connection successful"

echo ""
echo -e "${BLUE}Starting deployment...${NC}"
echo ""

# Deploy files to server
echo -e "${YELLOW}[1/5] Deploying files to server...${NC}"
./deploy/deploy-to-server.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓${NC} Files deployed"

# Run setup on server
echo ""
echo -e "${YELLOW}[2/5] Running setup on server...${NC}"
ssh marmok@192.168.1.251 "cd /opt/data-module && ./deploy/setup-production.sh"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Setup failed!${NC}"
    echo "Check logs on server:"
    echo "  ssh marmok@192.168.1.251"
    echo "  cd /opt/data-module"
    echo "  docker compose -f docker-compose.production.yml logs"
    exit 1
fi

echo -e "${GREEN}✓${NC} Setup complete"

# Wait for services to be healthy
echo ""
echo -e "${YELLOW}[3/5] Waiting for services to start...${NC}"
for i in {1..30}; do
    if ssh marmok@192.168.1.251 "cd /opt/data-module && docker compose -f docker-compose.production.yml ps | grep -q 'Up'" &> /dev/null; then
        echo -e "${GREEN}✓${NC} Services are up"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Services failed to start${NC}"
        exit 1
    fi
    sleep 2
    echo -n "."
done

# Check health
echo ""
echo -e "${YELLOW}[4/5] Checking system health...${NC}"
ssh marmok@192.168.1.251 "cd /opt/data-module && docker compose -f docker-compose.production.yml exec -T worker pnpm --filter @data-module/worker health" || true

# Show running services
echo ""
echo -e "${YELLOW}[5/5] Verifying deployment...${NC}"
ssh marmok@192.168.1.251 "cd /opt/data-module && docker compose -f docker-compose.production.yml ps"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}📊 Access Points:${NC}"
echo ""
echo "  🌐 Web UI (Manual Review):"
echo "     http://192.168.1.251:3000"
echo ""
echo "  🗄️ PostgreSQL:"
echo "     Host: 192.168.1.251:5432"
echo "     Database: data_module_sports"
echo "     User: sports_user"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo ""
echo "  SSH to server:"
echo "     ssh marmok@192.168.1.251"
echo ""
echo "  View logs:"
echo "     ssh marmok@192.168.1.251"
echo "     cd /opt/data-module"
echo "     docker compose -f docker-compose.production.yml logs -f worker"
echo ""
echo "  Check status:"
echo "     docker compose -f docker-compose.production.yml ps"
echo ""
echo "  Restart service:"
echo "     docker compose -f docker-compose.production.yml restart SERVICE_NAME"
echo ""
echo "  Stop all:"
echo "     docker compose -f docker-compose.production.yml down"
echo ""
echo -e "${BLUE}🔍 Next Steps:${NC}"
echo ""
echo "  1. Open web UI: http://192.168.1.251:3000"
echo "  2. Wait 5-10 minutes for initial data ingestion"
echo "  3. Check suggested matches in web UI"
echo "  4. Review and confirm/reject arbitrage opportunities"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT SECURITY NOTE:${NC}"
echo ""
echo "  Your Kalshi API private key was exposed in this chat."
echo "  After testing, please:"
echo "  1. Generate a new API key at: https://kalshi.com"
echo "  2. Update secrets/kalshi-private-key.pem"
echo "  3. Update KALSHI_API_KEY_ID in .env.production"
echo "  4. Redeploy: ./DEPLOY_NOW.sh"
echo ""
echo "Happy arbitraging! 🚀"
