# ⚡ Quick Start - Sports Arbitrage

**Deploy sports-only арбитраж на сервер за 5 минут**

---

## 🚀 One-Click Deployment

```bash
# В корне проекта, запусти:
./DEPLOY_NOW.sh
```

**Что произойдет:**
1. ✅ Проверка credentials и SSH connection
2. ✅ Деплой файлов на 192.168.1.251
3. ✅ Установка Docker, Node.js, pnpm (если нужно)
4. ✅ Build проекта и DB migrations
5. ✅ Запуск всех сервисов
6. ✅ Backfill taxonomy и events
7. ✅ Population watchlist

**Время:** ~5-10 минут

---

## 📊 После deployment

### 1. Открой Web UI

```
http://192.168.1.251:3000
```

**Что увидишь:**
- Список suggested matches (sports arbitrage opportunities)
- Score, venue, market titles
- Кнопки Confirm/Reject для manual review

### 2. Подожди 5-10 минут

**Первая ingestion run:**
- Kalshi: фетчит 5000-10000 спортивных рынков
- Polymarket: фетчит 3000-7000 спортивных рынков
- V3 matching: создает 100-500+ suggestions

### 3. Review арбитражи

**В web UI:**
1. Сортируй по score (высокий = точное совпадение)
2. Проверь что команды, лиги, даты совпадают
3. Confirm для точных matches
4. Reject для false positives

**Auto-confirm:**
- MONEYLINE matches с score >0.92 автоматически confirmed
- SPREAD/TOTAL требуют manual review

---

## 🔍 Monitoring

### SSH на сервер

```bash
ssh marmok@192.168.1.251
cd /opt/data-module
```

### Проверить статус

```bash
# Все сервисы
docker compose -f docker-compose.production.yml ps

# Должно быть ~8 сервисов Up:
# ✅ sports_db (PostgreSQL)
# ✅ sports_worker (matching)
# ✅ sports_ingestion_kalshi
# ✅ sports_ingestion_polymarket
# ✅ sports_quotes (quotes worker)
# ✅ sports_events_sync
# ✅ sports_monitoring
# ✅ sports_web_ui (Web UI на порту 3000)
```

### Посмотреть логи

```bash
# Все логи
docker compose -f docker-compose.production.yml logs -f

# Конкретный сервис
docker compose -f docker-compose.production.yml logs -f worker
docker compose -f docker-compose.production.yml logs -f ingestion-kalshi
docker compose -f docker-compose.production.yml logs -f web-ui
```

### Health check

```bash
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker health

# Должно показать:
# ✅ Database: healthy
# ✅ Ingestion: recent runs
# ✅ Matching: active
# ✅ Quotes: fresh
```

---

## 📈 Check Coverage

### Сколько спортивных рынков?

```bash
docker compose -f docker-compose.production.yml exec postgres \
  psql -U sports_user -d data_module_sports -c "
    SELECT
      venue,
      COUNT(*) FILTER (WHERE derived_topic = 'SPORTS') as sports_total,
      COUNT(*) FILTER (WHERE derived_topic = 'SPORTS' AND status = 'open') as open_sports,
      COUNT(*) FILTER (WHERE derived_topic = 'SPORTS' AND is_mve = false) as matchable
    FROM markets
    GROUP BY venue;
  "

# Expected:
# kalshi: 5000-10000 sports, 2000-5000 open, 4000-8000 matchable
# polymarket: 3000-7000 sports, 1500-4000 open, 3000-7000 matchable
```

### Топ suggested matches

```bash
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker v3:best --topic SPORTS

# Покажет топ 20 matches с самым высоким score
```

### Breakdown по лигам

```bash
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker sports:audit

# Покажет распределение по NBA, NFL, EPL, etc.
```

---

## 🛠️ Common Tasks

### Restart сервиса

```bash
cd /opt/data-module
docker compose -f docker-compose.production.yml restart worker
docker compose -f docker-compose.production.yml restart web-ui
```

### Stop/Start все

```bash
# Stop
docker compose -f docker-compose.production.yml down

# Start
docker compose -f docker-compose.production.yml up -d
```

### Manual matching run

```bash
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker v3:suggest-matches --topic SPORTS
```

### Backup БД

```bash
cd /opt/data-module
./deploy/backup.sh

# Backup сохранится в: backups/postgres/backup_YYYYMMDD_HHMMSS.sql.gz
```

### Update watchlist

```bash
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker links:watchlist:sync
```

---

## 🐛 Troubleshooting

### Web UI не открывается (http://192.168.1.251:3000)

```bash
# Проверить что сервис запущен
docker compose -f docker-compose.production.yml ps web-ui

# Проверить логи
docker compose -f docker-compose.production.yml logs web-ui

# Restart
docker compose -f docker-compose.production.yml restart web-ui
```

### Нет спортивных рынков

```bash
# Проверить ingestion
docker compose -f docker-compose.production.yml logs ingestion-kalshi
docker compose -f docker-compose.production.yml logs ingestion-polymarket

# Проверить что SPORTS_ONLY_MODE=true
docker compose -f docker-compose.production.yml exec worker env | grep SPORTS

# Manual ingestion run
docker compose -f docker-compose.production.yml exec ingestion-kalshi \
  pnpm --filter @data-module/worker ingest -v kalshi -m once
```

### Quotes не обновляются

```bash
# Проверить quotes worker
docker compose -f docker-compose.production.yml logs quotes-worker

# Проверить watchlist
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker watchlist:stats

# Repopulate watchlist
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker links:watchlist:sync
```

### PostgreSQL проблемы

```bash
# Проверить что БД запущена
docker compose -f docker-compose.production.yml ps postgres

# Проверить логи
docker compose -f docker-compose.production.yml logs postgres

# Подключиться к БД
docker compose -f docker-compose.production.yml exec postgres \
  psql -U sports_user -d data_module_sports
```

---

## 📚 Полная документация

- **SPORTS_SPECIALIZATION_PLAN.md** - 4-week план специализации
- **DEPLOYMENT_GUIDE.md** - детальная инструкция deployment
- **SPORTS_COVERAGE_100PCT.md** - стратегия 100% покрытия
- **CLAUDE.md** - полный список CLI команд
- **CHANGELOG.md** - история версий

---

## ⚠️ Important Notes

### 1. Kalshi API Key Security

**КРИТИЧНО:** Твой Kalshi private key был exposed в чате!

**После тестирования:**
1. Перейди на https://kalshi.com
2. Сгенерируй новый API key
3. Обнови `secrets/kalshi-private-key.pem`
4. Обнови `KALSHI_API_KEY_ID` в `.env.production`
5. Redeploy: `./DEPLOY_NOW.sh`

### 2. 100% Sports Coverage

Система настроена на фетч ВСЕХ спортивных событий:
- ✅ 50+ лиг (NBA, NFL, EPL, UFC, LoL, Dota2, etc.)
- ✅ MVE фильтрация (Same-Game Parlay excluded)
- ✅ Auto-sync events каждые 6 часов
- ✅ Watchlist с priority tiers

### 3. Auto-Confirm Settings

**Текущие настройки:**
- ✅ MONEYLINE: auto-confirm при score >0.92
- ❌ SPREAD: manual review (line values могут отличаться)
- ❌ TOTAL: manual review (same reason)

**Можно изменить в `.env.production`:**
```bash
AUTO_CONFIRM_MONEYLINE=true   # Текущее
AUTO_CONFIRM_SPREAD=false     # Можно включить если уверен
AUTO_CONFIRM_TOTAL=false      # Можно включить если уверен
```

---

## 🎯 Success Metrics

**После 24 часов работы, ожидай:**

- ✅ 5000-10000 Kalshi sports markets
- ✅ 3000-7000 Polymarket sports markets
- ✅ 100-500+ suggested matches
- ✅ 20-30% auto-confirmed (MONEYLINE)
- ✅ Web UI доступен 24/7
- ✅ Quotes обновляются каждые 15-60s
- ✅ Zero downtime

**Arbitrage opportunities:**
- Будут появляться когда коэффициенты на Kalshi и Polymarket разойдутся
- Наиболее частые для MONEYLINE (winner markets)
- Проверяй web UI каждые 1-2 часа
- Urgent events (closeTime <2 часа) мониторятся с интервалом 15s

---

## 🚀 You're All Set!

**Workflow:**
1. ✅ Deploy: `./DEPLOY_NOW.sh`
2. ✅ Wait 5-10 min for initial data
3. ✅ Open http://192.168.1.251:3000
4. ✅ Review suggested matches
5. ✅ Confirm arbitrage opportunities
6. ✅ Profit! 💰

**Questions?**
- Check logs first
- Read DEPLOYMENT_GUIDE.md
- Check SPORTS_COVERAGE_100PCT.md for coverage issues

**Happy arbitraging! 🎯**
