# Sports-Only Specialization Plan

**Дата:** 2026-01-31
**Цель:** Переориентация проекта на спортивный/киберспортивный арбитраж между Kalshi и Polymarket
**Remote Server:** 192.168.1.251 (user: marmok)

---

## 📋 Executive Summary

### Текущая ситуация
- ✅ Есть зрелый sports pipeline (v3.0.14) с event-first matching
- ✅ Поддержка 30+ лиг (NBA, NFL, MLB, EPL, UFC, LoL, Dota2, CS:GO, etc.)
- ✅ MVE detection для фильтрации Same-Game Parlay
- ✅ Auto-confirm для MONEYLINE с точностью 92%+
- ⚠️ Система работает на ВСЕ типы рынков (crypto, rates, climate, etc.)

### Целевое состояние
- 🎯 ТОЛЬКО спортивные/киберспортивные рынки (букмекерские события)
- 🎯 Высокочастотные quote updates для live odds
- 🎯 MVE фильтрация (SGP не подходят для арбитража)
- 🎯 Optimized watchlist только для спортивных матчей
- 🎯 Production deployment на удаленном сервере

---

## 🎯 Phase 1: Architecture Changes (Week 1)

### 1.1 Sports-Only Mode Configuration

**Создать новый env flag:**
```bash
# .env.production
SPORTS_ONLY_MODE=true                    # Включить режим "только спорт"
FOCUS_TOPICS=SPORTS                      # Единственный активный топик
EXCLUDE_MVE_MARKETS=true                 # Фильтровать Same-Game Parlay
```

**Impact:**
- Ingestion будет фетчить ТОЛЬКО спортивные рынки
- V3 engine будет запускать ТОЛЬКО sports pipeline
- Watchlist будет содержать ТОЛЬКО спортивные маркеты

### 1.2 Database Query Optimization

**Оптимизации для sports-only:**

```sql
-- Создать индексы для быстрой фильтрации спортивных рынков
CREATE INDEX idx_markets_sports ON markets(venue, derived_topic)
  WHERE derived_topic = 'SPORTS' AND is_mve = false;

-- Индекс для quick lookup по событиям
CREATE INDEX idx_markets_kalshi_event ON markets(kalshi_event_ticker)
  WHERE kalshi_event_ticker IS NOT NULL;

-- Индекс для closeTime фильтрации (live events)
CREATE INDEX idx_markets_sports_close_time ON markets(close_time)
  WHERE derived_topic = 'SPORTS' AND status = 'open';
```

**Модифицировать repository queries:**
- `listEligibleMarkets()` - добавить жесткий фильтр `derivedTopic = 'SPORTS'`
- `getConfirmedLinks()` - добавить фильтр только спортивных линков
- Удалить queries для других топиков (CRYPTO, RATES, etc.)

### 1.3 Ingestion Pipeline Changes

**Kalshi Adapter:**
```typescript
// services/worker/src/adapters/kalshi.adapter.ts
// Добавить фильтрацию на уровне API запроса

async fetchMarkets(options) {
  const params = {
    // Фильтровать только спортивные серии
    series_ticker_prefix: [
      'KXNBA', 'KXNFL', 'KXMLB', 'KXNHL',  // US sports
      'KXEPL', 'KXUCL', 'KXLALIGA',         // Soccer
      'KXUFC', 'KXTENNIS', 'KXF1',          // Individual
      'KXLOL', 'KXDOTA', 'KXCSGO',          // Esports
    ],
    // Исключить MVE
    exclude_mve: process.env.EXCLUDE_MVE_MARKETS === 'true',
  };

  // ...
}
```

**Polymarket Adapter:**
```typescript
// services/worker/src/adapters/polymarket.adapter.ts
// Фильтровать по clob_token_ids спортивных событий

async fetchMarkets(options) {
  // Получить только спортивные events
  const sportsEvents = await this.fetchSportsEvents();
  const clobTokenIds = sportsEvents.map(e => e.clobTokenIds).flat();

  // Fetch markets только для этих IDs
  return this.fetchMarketsByTokenIds(clobTokenIds);
}
```

---

## ⚡ Phase 2: Sports-Specific Optimizations (Week 2)

### 2.1 High-Frequency Quote Updates

**Problem:** Спортивные коэффициенты меняются быстрее чем crypto/rates.

**Solution:**
```bash
# .env.production
QUOTES_MODE=watchlist                    # Только watchlist markets
QUOTES_INTERVAL_SECONDS=15               # 15 секунд вместо 60
QUOTES_WATCHLIST_LIMIT=500               # Топ 500 активных матчей
WATCHLIST_PRIORITY_THRESHOLD=7200        # 2 часа до closeTime = HIGH priority
```

**Watchlist Strategy:**
1. **HIGH priority** (15s interval): События начинаются в течение 2 часов
2. **MEDIUM priority** (30s interval): События в течение 24 часов
3. **LOW priority** (60s interval): События >24 часов

### 2.2 Live Events Monitoring

**Новый модуль:** `services/worker/src/monitoring/live-events.ts`

```typescript
/**
 * Мониторинг событий близких к началу
 * Алерты когда closeTime < 15 минут
 */
export class LiveEventsMonitor {
  async checkUrgentEvents() {
    const urgentMarkets = await repo.findMarkets({
      derivedTopic: 'SPORTS',
      closeTimeWithin: 15 * 60 * 1000, // 15 минут
      status: 'open',
    });

    for (const market of urgentMarkets) {
      // Проверить линки
      const links = await linkRepo.getLinksForMarket(market.id);

      // Вычислить arbitrage opportunities
      const arbs = calculateArbitrage(links);

      if (arbs.length > 0) {
        // ALERT: Арбитраж доступен, событие начинается скоро!
        await this.sendAlert(market, arbs);
      }
    }
  }
}
```

### 2.3 Enhanced Sports Pipeline

**Улучшения для букмекерских событий:**

1. **Расширить поддержку киберспорта:**
   - Best-of-3, Best-of-5 map series
   - Map winner markets
   - Total maps markets

2. **Добавить live odds tracking:**
   - Отслеживать изменение коэффициентов в реальном времени
   - Детектить sharp movements (> 10% за минуту)

3. **Улучшить line value matching:**
   - Для SPREAD/TOTAL: tolerance ±0.5 вместо ±2.0
   - Более строгие правила для auto-confirm

---

## 🐳 Phase 3: Production Deployment (Week 3)

### 3.1 Docker Setup

**Создать:** `docker-compose.production.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: data_module
      POSTGRES_USER: sports_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sports_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sports_user:${DB_PASSWORD}@postgres:5432/data_module
      SPORTS_ONLY_MODE: "true"
      EXCLUDE_MVE_MARKETS: "true"
      QUOTES_INTERVAL_SECONDS: 15
      KALSHI_MODE: catalog
      KALSHI_API_KEY_ID: ${KALSHI_API_KEY_ID}
      KALSHI_PRIVATE_KEY_PATH: /secrets/kalshi-private-key.pem
    volumes:
      - ./secrets:/secrets:ro
      - ./logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    command: pnpm --filter @data-module/worker ops:run:v3 --topics SPORTS

  ingestion-kalshi:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sports_user:${DB_PASSWORD}@postgres:5432/data_module
      SPORTS_ONLY_MODE: "true"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    command: pnpm --filter @data-module/worker ingest -v kalshi -m split

  ingestion-polymarket:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sports_user:${DB_PASSWORD}@postgres:5432/data_module
      SPORTS_ONLY_MODE: "true"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    command: pnpm --filter @data-module/worker ingest -v polymarket -m split

  quotes-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sports_user:${DB_PASSWORD}@postgres:5432/data_module
      QUOTES_MODE: watchlist
      QUOTES_INTERVAL_SECONDS: 15
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    command: pnpm --filter @data-module/worker quotes:loop

  monitoring:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://sports_user:${DB_PASSWORD}@postgres:5432/data_module
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    command: pnpm --filter @data-module/worker monitor:live-events

volumes:
  postgres_data:
```

### 3.2 Deployment Scripts

**Создать:** `deploy/setup-production.sh`

```bash
#!/bin/bash
# Production setup script for remote server (192.168.1.251)

set -e

echo "🚀 Setting up Data Module Sports-Only on production..."

# 1. Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# 2. Build packages
echo "🔨 Building packages..."
pnpm build

# 3. Run migrations
echo "🗄️ Running database migrations..."
pnpm --filter @data-module/db db:migrate

# 4. Backfill sports taxonomy (one-time)
echo "🏷️ Backfilling sports taxonomy..."
pnpm --filter @data-module/worker kalshi:taxonomy:backfill
pnpm --filter @data-module/worker polymarket:taxonomy:backfill

# 5. Sync Kalshi events
echo "📅 Syncing Kalshi events..."
pnpm --filter @data-module/worker kalshi:events:smart-sync --non-mve

# 6. Initial watchlist population
echo "👀 Populating watchlist..."
pnpm --filter @data-module/worker links:watchlist:sync

# 7. Start services
echo "🐳 Starting Docker services..."
docker compose -f docker-compose.production.yml up -d

echo "✅ Deployment complete!"
echo "📊 Check status: docker compose -f docker-compose.production.yml ps"
echo "📋 View logs: docker compose -f docker-compose.production.yml logs -f worker"
```

**Создать:** `deploy/backup.sh`

```bash
#!/bin/bash
# Daily backup script

BACKUP_DIR="/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="data_module"

echo "🔄 Starting backup: $DATE"

# Backup database
docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump -U sports_user $DB_NAME | gzip > "$BACKUP_DIR/backup_$DATE.sql.gz"

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "✅ Backup complete: backup_$DATE.sql.gz"
```

### 3.3 Environment Configuration

**Создать:** `.env.production`

```bash
# Database
DB_PASSWORD=<STRONG_PASSWORD>
DATABASE_URL=postgresql://sports_user:${DB_PASSWORD}@localhost:5432/data_module

# Sports-Only Mode
SPORTS_ONLY_MODE=true
FOCUS_TOPICS=SPORTS
EXCLUDE_MVE_MARKETS=true

# Kalshi API
KALSHI_MODE=catalog
KALSHI_API_KEY_ID=<YOUR_KEY_ID>
KALSHI_PRIVATE_KEY_PATH=/secrets/kalshi-private-key.pem
HTTP_PROXY=  # If needed

# Quotes
QUOTES_MODE=watchlist
QUOTES_INTERVAL_SECONDS=15
QUOTES_WATCHLIST_LIMIT=500

# Eligibility
ELIGIBILITY_LOOKBACK_HOURS_SPORTS=168  # 7 days
ELIGIBILITY_GRACE_MINUTES=15

# Operations
OPS_INTERVAL_MINUTES=10
OPS_AUTO_CONFIRM=true
OPS_AUTO_REJECT=true

# Monitoring
ENABLE_LIVE_EVENTS_MONITOR=true
LIVE_EVENT_THRESHOLD_MINUTES=15
ALERT_WEBHOOK_URL=<DISCORD/SLACK_WEBHOOK>  # Optional

# Logging
LOG_LEVEL=info
LOG_FILE=/app/logs/worker.log
```

---

## 🔍 Phase 4: Monitoring & Optimization (Week 4)

### 4.1 Health Checks

**Создать:** `services/worker/src/monitoring/health.ts`

```typescript
export interface HealthStatus {
  database: 'healthy' | 'degraded' | 'down';
  ingestion: {
    kalshi: { lastRun: Date; status: string };
    polymarket: { lastRun: Date; status: string };
  };
  matching: { lastRun: Date; suggestedCount: number };
  quotes: { freshness: number; stalePct: number };
  liveEvents: { urgentCount: number; arbiCount: number };
}

export async function checkHealth(): Promise<HealthStatus> {
  // Check DB connection
  // Check last ingestion run
  // Check quotes freshness
  // Check for urgent events
  // Calculate arbitrage opportunities
}
```

### 4.2 Metrics Dashboard

**Key metrics to track:**

1. **Ingestion:**
   - Markets fetched per hour (Kalshi/Polymarket)
   - Sports markets as % of total
   - MVE markets filtered out

2. **Matching:**
   - Suggested links per hour
   - Auto-confirm rate
   - Average match score

3. **Quotes:**
   - Quote updates per second
   - Freshness (<1min, <5min, >5min)
   - Watchlist coverage

4. **Arbitrage:**
   - Opportunities detected
   - Average arb %
   - Urgent events monitored

---

## ⚠️ Critical Risks & Mitigation

### Risk 1: Потеря данных по другим топикам
**Mitigation:**
- ✅ Full DB backup ПЕРЕД переходом на sports-only
- ✅ Soft delete: не удалять старые данные, просто не фетчить новые
- ✅ Feature flag для быстрого rollback

### Risk 2: MVE markets проскакивают через фильтр
**Mitigation:**
- ✅ Double-check на уровне БД индексов
- ✅ V3 eligibility с явной проверкой `isMve = false`
- ✅ Audit команда для проверки

### Risk 3: Quotes не успевают за live odds
**Mitigation:**
- ✅ Priority-based watchlist (urgent events = 15s)
- ✅ Мониторинг quote lag
- ✅ Auto-scaling для quotes workers

### Risk 4: Server downtime
**Mitigation:**
- ✅ Docker restart policies
- ✅ Health checks
- ✅ Daily backups
- ✅ Monitoring alerts

### Risk 5: API rate limits
**Mitigation:**
- ✅ Exponential backoff
- ✅ Retry-After support
- ✅ Batch requests
- ✅ Caching for static data (leagues, teams)

---

## 📊 Success Metrics

### Week 1 (Architecture)
- [ ] SPORTS_ONLY_MODE implemented
- [ ] DB migrations completed
- [ ] Ingestion filters only sports markets
- [ ] 0% non-sports markets in new fetches

### Week 2 (Optimization)
- [ ] Quote updates <15s for urgent events
- [ ] MVE markets filtered: >95% accuracy
- [ ] Watchlist populated with top 500 sports markets

### Week 3 (Deployment)
- [ ] Production server running 192.168.1.251
- [ ] All services healthy
- [ ] Daily backups configured
- [ ] Logs accessible

### Week 4 (Monitoring)
- [ ] Health dashboard live
- [ ] Arbitrage opportunities detected
- [ ] <1% stale quotes
- [ ] Zero downtime for 7 days

---

## 🚀 Quick Start Commands

### Development (Local)
```bash
# Switch to sports-only mode
export SPORTS_ONLY_MODE=true
export FOCUS_TOPICS=SPORTS

# Run ingestion
pnpm --filter @data-module/worker ingest -v kalshi -m split &
pnpm --filter @data-module/worker ingest -v polymarket -m split &

# Run matching
pnpm --filter @data-module/worker ops:run:v3 --topics SPORTS

# Monitor
pnpm --filter @data-module/worker health
```

### Production (Remote)
```bash
# SSH to server
ssh marmok@192.168.1.251

# Deploy
cd /opt/data-module
./deploy/setup-production.sh

# Check status
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f worker

# Backup
./deploy/backup.sh
```

---

## 📚 Next Steps

1. **Review this plan** - убедиться что все риски учтены
2. **Prepare production server** - install Docker, setup user permissions
3. **Create .env.production** - configure API keys, passwords
4. **Test locally first** - run sports-only mode on laptop
5. **Deploy to staging** - test on small dataset
6. **Deploy to production** - full migration

**ETA:** 4 недели до полного production deployment

**Owner:** Claude Code + User (marmok@192.168.1.251)

---

## 🤝 Support

**Questions:** Check CLAUDE.md, CHANGELOG.md, FIXES_SUMMARY.md
**Issues:** GitHub issues or direct contact
**Logs:** `/app/logs/worker.log` in Docker container
