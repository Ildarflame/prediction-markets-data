# 100% Sports Coverage Strategy

**Цель:** Покрывать ВСЕ спортивные события на Kalshi и Polymarket для максимизации арбитражных возможностей

---

## 📊 Current Coverage

### Kalshi Sports Series (по данным из sportsSignals.ts)

**US Major Leagues:**
- ✅ NBA (KXNBA*)
- ✅ NFL (KXNFL*)
- ✅ MLB (KXMLB*)
- ✅ NHL (KXNHL*)
- ✅ MLS (KXMLS*)

**College Sports:**
- ✅ NCAA Men's Basketball (KXNCAAMB*, KXNCAABB*, KXNCAA*)
- ✅ NCAA Women's Basketball (KXNCAAWB*)
- ✅ NCAA Football (KXNCAAFB*)

**European Soccer:**
- ✅ English Premier League (KXEPL*)
- ✅ La Liga (KXLALIGA*)
- ✅ Bundesliga (KXBUNDES*)
- ✅ Serie A (KXSERIEA*)
- ✅ Ligue 1 (KXLIGUE1*)
- ✅ Champions League (KXUCL*)
- ✅ Europa League (KXUEL*)
- ✅ Scottish Premiership (KXSCOTTISH*)
- ✅ Eredivisie (KXEREDIV*)
- ✅ Primeira Liga (KXPORTUGAL*)
- ✅ Generic Soccer (KXSOCCER*)

**Combat Sports:**
- ✅ UFC (KXUFC*)
- ✅ Boxing (KXBOXING*)
- ✅ WWE (KXWWE*)

**Individual Sports:**
- ✅ Tennis (KXTENNIS*)
- ✅ Golf/PGA (KXPGA*, KXPGATOUR*)
- ✅ Chess (KXCHESS*)
- ✅ Table Tennis (KXTABLETEN*)

**Motorsport:**
- ✅ Formula 1 (KXF1*)
- ✅ NASCAR (KXNASCAR*)
- ✅ IndyCar (KXINDYCAR*)
- ✅ MotoGP (KXMOTOGP*)
- ✅ Generic Motorsport (KXMOTORSPORT*)

**Esports:**
- ✅ Dota 2 (KXDOTA*, KXDOTA2*)
- ✅ Valorant (KXVALORANT*)
- ✅ League of Legends (KXLOL*)
- ✅ CS:GO/CS2 (KXCSGO*, KXCS2*)
- ✅ Generic Esports (KXESPORT*, KXMVESPORT*)

**Other Sports:**
- ✅ Cricket (KXCRICKET*, KXIPL*)
- ✅ Olympics (KXOLYMPIC*)
- ✅ Horse Racing (KXHORSERACE*, KXDERBY*)

**TOTAL: 50+ league patterns supported**

---

## 🎯 Strategy for 100% Coverage

### 1. Kalshi Ingestion Settings

```bash
# .env.production
KALSHI_MODE=catalog  # Use catalog mode to discover ALL series

# Fetch ALL sports series (no filtering)
KALSHI_SERIES_FILTER=sports  # Internal filter: only sports-related series

# Unlimited markets
KALSHI_MAX_MARKETS=999999999

# Lookback to capture historical and upcoming events
ELIGIBILITY_LOOKBACK_HOURS_SPORTS=336  # 14 days (2 weeks)
```

### 2. Series Discovery & Auto-Update

**Problem:** New leagues/tournaments появляются со временем (e.g., Women's World Cup, new esports tournaments)

**Solution:** Периодический sync всех Kalshi series

```bash
# Run daily via cron
0 2 * * * cd /opt/data-module && docker compose -f docker-compose.production.yml exec worker pnpm --filter @data-module/worker kalshi:series:sync
```

**What it does:**
- Fetches ALL series from Kalshi API
- Detects new sports series (prefix KX*)
- Updates series metadata (categories, tags)
- Automatically classifies new series into leagues

### 3. Event Enrichment

**Problem:** Market titles могут быть incomplete или содержать props/parlays

**Solution:** Event-first matching (уже реализовано в v3.0.12)

```typescript
// В sportsPipeline.ts уже есть:
- extractSportsSignals() использует eventData для team/time extraction
- kalshiEventRepo.getEventsMap() batch fetches events
- Event data приоритетнее market titles
```

**Убедиться что events sync работает:**

```bash
# Smart sync: fetch events только для markets без event data
docker compose exec worker pnpm --filter @data-module/worker kalshi:events:smart-sync --non-mve

# Coverage audit
docker compose exec worker pnpm --filter @data-module/worker sports:event-coverage --venue kalshi
```

### 4. MVE Filtering (Critical!)

**Problem:** Same-Game Parlays (MVE) не подходят для арбитража

**Solution:** Explicit MVE filtering на всех уровнях

```typescript
// V3 eligibility (уже реализовано)
if (market.isMve === true) {
  return { eligible: false, reason: 'mve_excluded' };
}

// DB query level
SELECT * FROM markets
WHERE derived_topic = 'SPORTS'
  AND is_mve = false  -- Explicit non-MVE only
```

**Audit MVE detection:**

```bash
# Check MVE coverage
docker compose exec worker pnpm --filter @data-module/worker kalshi:mve:audit

# Expected output:
# - isMve = false: 80%+ (matchable events)
# - isMve = true: 10-15% (SGP filtered out)
# - isMve = null: <5% (unknowns, will be backfilled)
```

### 5. Polymarket Coverage

**Polymarket uses event-based structure** (not series like Kalshi)

**Strategy:**

```bash
# Sync Polymarket sports events
docker compose exec worker pnpm --filter @data-module/worker polymarket:events:sync

# Check coverage
docker compose exec worker pnpm --filter @data-module/worker polymarket:events:coverage

# Expected topics:
# - Sports > Basketball > NBA
# - Sports > Football > NFL
# - Sports > Soccer > EPL
# - Sports > Esports > LoL
# etc.
```

**Polymarket ingestion settings:**

```bash
# Fetch unlimited markets
POLYMARKET_MAX_MARKETS=999999999

# Use cursor-based pagination (for full coverage)
POLYMARKET_USE_CURSOR=true
```

---

## 🔍 Coverage Verification

### Daily Checks

**1. Sports market counts:**

```sql
SELECT
  venue,
  COUNT(*) FILTER (WHERE derived_topic = 'SPORTS') as sports_markets,
  COUNT(*) FILTER (WHERE derived_topic = 'SPORTS' AND is_mve = false) as matchable,
  COUNT(*) FILTER (WHERE derived_topic = 'SPORTS' AND status = 'open') as open_sports
FROM markets
GROUP BY venue;
```

**Expected output:**
```
venue       | sports_markets | matchable | open_sports
------------|----------------|-----------|------------
kalshi      | 5000-10000     | 4000-8000 | 2000-5000
polymarket  | 3000-7000      | 3000-7000 | 1500-4000
```

**2. League distribution:**

```bash
docker compose exec worker pnpm --filter @data-module/worker sports:audit

# Shows breakdown by league:
# NBA: 150 markets
# NFL: 80 markets
# EPL: 120 markets
# etc.
```

**3. Event linkage coverage:**

```bash
docker compose exec worker pnpm --filter @data-module/worker sports:event-coverage --venue kalshi

# Expected: >80% of markets have event data
```

**4. Suggested matches:**

```bash
docker compose exec worker pnpm --filter @data-module/worker v3:suggest-matches --topic SPORTS

# Should produce 100-500+ suggestions per run
```

---

## 📈 Optimization for Maximum Coverage

### 1. Eligibility Tuning

```bash
# Current settings (conservative)
ELIGIBILITY_LOOKBACK_HOURS_SPORTS=336  # 14 days

# For 100% coverage, можно расширить:
ELIGIBILITY_LOOKBACK_HOURS_SPORTS=720  # 30 days

# Но это увеличит нагрузку на БД и matching
```

**Trade-off:**
- Longer lookback = more markets = more matches
- But: старые события могут быть irrelevant для арбитража

**Recommendation:** 14 дней (2 недели) достаточно для большинства спортивных событий

### 2. Watchlist Strategy

**Problem:** 1000 markets в watchlist может быть недостаточно для 100% coverage

**Solution:** Priority-based tiering

```typescript
// Priority tiers:
// HIGH (15s interval): closeTime < 2 hours, confirmed links
// MEDIUM (30s interval): closeTime 2-24 hours, top suggested
// LOW (60s interval): closeTime 24-168 hours, all other sports

// Limits per tier:
QUOTES_WATCHLIST_LIMIT_HIGH=300   // Urgent events
QUOTES_WATCHLIST_LIMIT_MEDIUM=500 // Soon events
QUOTES_WATCHLIST_LIMIT_LOW=700    // Future events
// TOTAL: 1500 markets
```

### 3. Auto-Sync Automation

**Create cron jobs для полной автоматизации:**

```bash
# crontab -e
# Add these lines:

# Kalshi series sync (daily at 2am)
0 2 * * * cd /opt/data-module && docker compose -f docker-compose.production.yml exec -T worker pnpm --filter @data-module/worker kalshi:series:sync

# Kalshi events sync (every 6 hours)
0 */6 * * * cd /opt/data-module && docker compose -f docker-compose.production.yml exec -T worker pnpm --filter @data-module/worker kalshi:events:smart-sync --non-mve

# Polymarket events sync (daily at 3am)
0 3 * * * cd /opt/data-module && docker compose -f docker-compose.production.yml exec -T worker pnpm --filter @data-module/worker polymarket:events:sync

# Watchlist sync (every hour)
0 * * * * cd /opt/data-module && docker compose -f docker-compose.production.yml exec -T worker pnpm --filter @data-module/worker links:watchlist:sync

# Backup (daily at 4am)
0 4 * * * cd /opt/data-module && ./deploy/backup.sh
```

---

## ✅ Coverage Checklist

**Before going live, verify:**

- [ ] All 50+ league patterns detected by `detectLeagueFromSeriesTicker()`
- [ ] Kalshi series sync working (`kalshi:series:sync`)
- [ ] Kalshi events sync working (`kalshi:events:smart-sync --non-mve`)
- [ ] Polymarket events sync working (`polymarket:events:sync`)
- [ ] MVE filtering accurate (>95% detection rate)
- [ ] Ingestion fetching unlimited markets
- [ ] Eligibility lookback = 14-30 days
- [ ] Watchlist populated with 1000-1500 sports markets
- [ ] Auto-sync cron jobs configured
- [ ] Coverage audits scheduled (daily)

**KPIs for 100% coverage:**

- ✅ **Kalshi sports markets:** 5000-10000
- ✅ **Polymarket sports markets:** 3000-7000
- ✅ **Event linkage:** >80% of markets have event data
- ✅ **MVE detection:** >95% accuracy
- ✅ **Suggested matches:** 100-500+ per matching run
- ✅ **Auto-confirm rate:** 20-30% for MONEYLINE
- ✅ **Zero missed major events** (NBA finals, Super Bowl, World Cup matches, etc.)

---

## 🚨 Monitoring Gaps

**Set up alerts для missed coverage:**

```bash
# 1. Check for major events without matches
# (e.g., Lakers vs Celtics should have both Kalshi and Polymarket markets)

# 2. Alert if new league detected but not in our mapping
# (indicates we need to add to detectLeagueFromSeriesTicker)

# 3. Alert if MVE detection rate drops below 90%
# (indicates Kalshi API changed MVE fields)

# 4. Alert if events sync stale (>24 hours since last run)
```

---

## 📞 Troubleshooting

**Q: Not seeing matches for specific league (e.g., EPL)?**

A: Check:
1. Are markets being fetched? `SELECT COUNT(*) FROM markets WHERE title ILIKE '%premier league%'`
2. Are they classified as SPORTS? `SELECT derived_topic FROM markets WHERE title ILIKE '%epl%'`
3. Are events synced? `sports:event-coverage --venue kalshi`
4. Is MVE filtering too aggressive? `kalshi:mve:audit`

**Q: Polymarket has event but Kalshi doesn't (or vice versa)?**

A: Normal. Not all events exist on both platforms.
- Focus on events that exist on BOTH for arbitrage
- Use `v3:suggest-matches --topic SPORTS` to find cross-venue matches

**Q: Coverage drops after update?**

A: Check:
1. New series added to Kalshi? Run `kalshi:series:sync`
2. MVE detection changed? Run `kalshi:mve:backfill`
3. Taxonomy classification stale? Run `kalshi:taxonomy:backfill --topic SPORTS`

---

**Goal:** 100% sports coverage = zero missed arbitrage opportunities! 🎯
