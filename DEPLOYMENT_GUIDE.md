# 🚀 Sports-Only Deployment Guide

**Quick start guide** для развертывания Data Module в режиме sports-only на сервере 192.168.1.251

---

## 📋 Pre-requisites

### На локальной машине:
- ✅ SSH доступ к 192.168.1.251 (user: marmok, pass: gimgimlil)
- ✅ Kalshi API credentials (key ID + private key PEM file)
- ✅ rsync installed

### На сервере (192.168.1.251):
- Docker будет установлен автоматически скриптом
- Docker Compose будет установлен автоматически
- Node.js 20 + pnpm будут установлены автоматически

---

## 🎯 Quick Start (30 минут до полного запуска)

### Step 1: Подготовка локально

```bash
# 1. Создать .env.production из примера
cp .env.production.example .env.production

# 2. Отредактировать .env.production
nano .env.production

# Обязательно заполнить:
# - DB_PASSWORD (сильный пароль для PostgreSQL)
# - KALSHI_API_KEY_ID (ваш Kalshi API key)
# - Остальное можно оставить по умолчанию
```

### Step 2: Подготовить Kalshi credentials

```bash
# Создать директорию для secrets
mkdir -p secrets

# Скопировать Kalshi private key
cp ~/path/to/kalshi-private-key.pem secrets/kalshi-private-key.pem

# Установить правильные permissions
chmod 600 secrets/kalshi-private-key.pem
chmod 700 secrets
```

### Step 3: Deploy на сервер

```bash
# Запустить deployment script
./deploy/deploy-to-server.sh

# Скрипт:
# ✅ Проверит SSH соединение
# ✅ Синхронизирует файлы на сервер
# ✅ Скопирует .env.production и secrets
# ✅ Установит Docker, Node.js, pnpm (если нужно)
```

### Step 4: Запуск на сервере

```bash
# SSH на сервер
ssh marmok@192.168.1.251
# Password: gimgimlil

# Перейти в проект
cd /opt/data-module

# Проверить что .env.production на месте
cat .env.production

# Запустить setup (это займет 5-10 минут)
./deploy/setup-production.sh

# Скрипт выполнит:
# ✅ Установку dependencies
# ✅ Build проекта
# ✅ Запуск PostgreSQL
# ✅ Database migrations
# ✅ Создание sports-specific индексов
# ✅ Backfill taxonomy
# ✅ Sync Kalshi events
# ✅ Populate watchlist
# ✅ Запуск всех сервисов
```

---

## 📊 Проверка что все работает

### 1. Проверить статус сервисов

```bash
docker compose -f docker-compose.production.yml ps

# Должно быть ~7 сервисов в статусе "Up":
# ✅ sports_db (PostgreSQL)
# ✅ sports_worker (V3 matching)
# ✅ sports_ingestion_kalshi
# ✅ sports_ingestion_polymarket
# ✅ sports_quotes (high-freq quotes)
# ✅ sports_events_sync
# ✅ sports_monitoring
```

### 2. Проверить логи

```bash
# Все логи
docker compose -f docker-compose.production.yml logs -f

# Только worker
docker compose -f docker-compose.production.yml logs -f worker

# Только ingestion
docker compose -f docker-compose.production.yml logs -f ingestion-kalshi
docker compose -f docker-compose.production.yml logs -f ingestion-polymarket

# Только quotes
docker compose -f docker-compose.production.yml logs -f quotes-worker
```

### 3. Проверить health

```bash
# Внутри контейнера
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker health

# Должны увидеть:
# ✅ Database: healthy
# ✅ Ingestion: recent runs
# ✅ Matching: active
# ✅ Quotes: fresh
```

### 4. Проверить что фетчатся только спортивные рынки

```bash
# Подключиться к PostgreSQL
docker compose -f docker-compose.production.yml exec postgres \
  psql -U sports_user -d data_module_sports

# SQL запрос
SELECT derived_topic, COUNT(*)
FROM markets
GROUP BY derived_topic
ORDER BY COUNT(*) DESC;

# Должно быть:
# SPORTS | XXXX  <-- большинство рынков
# (other topics should be minimal or zero for new markets)
```

---

## 🔧 Management Commands

### Restart сервиса

```bash
# Restart конкретного сервиса
docker compose -f docker-compose.production.yml restart worker
docker compose -f docker-compose.production.yml restart ingestion-kalshi
docker compose -f docker-compose.production.yml restart quotes-worker
```

### Stop/Start всех сервисов

```bash
# Stop all
docker compose -f docker-compose.production.yml down

# Start all
docker compose -f docker-compose.production.yml up -d

# Stop all and remove volumes (DANGER!)
docker compose -f docker-compose.production.yml down -v
```

### Backup базы данных

```bash
# Ручной backup
./deploy/backup.sh

# Backups сохраняются в: ./backups/postgres/
# Retention: 7 дней
```

### Настроить auto backup (cron)

```bash
# Добавить в crontab (daily at 3am)
crontab -e

# Add this line:
0 3 * * * cd /opt/data-module && ./deploy/backup.sh >> logs/backup.log 2>&1
```

### Manual matching run

```bash
# Run V3 matching вручную
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker v3:suggest-matches --topic SPORTS

# Посмотреть топ matches
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker v3:best --topic SPORTS
```

### Check watchlist

```bash
# Stats
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker watchlist:stats

# List markets
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker watchlist:list --venue kalshi
```

---

## 🐛 Troubleshooting

### Problem: Сервис не запускается

```bash
# Проверить логи
docker compose -f docker-compose.production.yml logs SERVICE_NAME

# Проверить что .env.production валидный
cat .env.production

# Проверить что secrets на месте
ls -la secrets/
```

### Problem: PostgreSQL не стартует

```bash
# Проверить логи
docker compose -f docker-compose.production.yml logs postgres

# Проверить permissions на volumes
docker volume inspect data_module_v1_postgres_data

# Полный reset (DANGER - потеряются данные!)
docker compose -f docker-compose.production.yml down -v
./deploy/setup-production.sh
```

### Problem: Quotes не обновляются

```bash
# Проверить quotes worker
docker compose -f docker-compose.production.yml logs quotes-worker

# Проверить watchlist
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker watchlist:stats

# Если watchlist пустой, re-populate:
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker links:watchlist:sync
```

### Problem: Нет спортивных рынков

```bash
# Проверить ingestion
docker compose -f docker-compose.production.yml logs ingestion-kalshi
docker compose -f docker-compose.production.yml logs ingestion-polymarket

# Проверить что SPORTS_ONLY_MODE=true
docker compose -f docker-compose.production.yml exec worker env | grep SPORTS

# Проверить Kalshi API credentials
docker compose -f docker-compose.production.yml exec ingestion-kalshi \
  cat /secrets/kalshi-private-key.pem
```

---

## 📈 Monitoring & Metrics

### Key metrics to watch:

1. **Ingestion Rate:**
   - Markets fetched per hour
   - Should see steady flow of new sports markets

2. **Matching Quality:**
   - Suggested links per hour
   - Auto-confirm rate (should be ~20-30%)
   - Average match score (should be >0.85)

3. **Quotes Freshness:**
   - % of markets with quotes <1min old
   - Should be >80% for watchlist markets

4. **Arbitrage Opportunities:**
   - Live events with arb %
   - Alert when profitable opportunities detected

### Access metrics:

```bash
# Database stats
docker compose -f docker-compose.production.yml exec postgres \
  psql -U sports_user -d data_module_sports -c "
    SELECT
      derived_topic,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'open') as open,
      COUNT(*) FILTER (WHERE is_mve = false) as non_mve
    FROM markets
    GROUP BY derived_topic;
  "

# Link stats
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker links:stats

# KPI dashboard
docker compose -f docker-compose.production.yml exec worker \
  pnpm --filter @data-module/worker ops:kpi
```

---

## 🔐 Security Best Practices

1. **Change default passwords:**
   - PostgreSQL password in .env.production
   - SSH password for marmok user

2. **Firewall rules:**
   - Only allow SSH (22) and PostgreSQL (5432) from trusted IPs
   - Block all other incoming traffic

3. **SSL certificates:**
   - Use SSL for PostgreSQL connections (optional)
   - Use HTTPS for any web UI (if added later)

4. **Secrets management:**
   - Never commit secrets/ directory to git
   - Keep backups encrypted
   - Rotate API keys periodically

5. **Regular updates:**
   - Update Docker images monthly
   - Update npm packages monthly
   - Apply security patches promptly

---

## 📞 Support

**Questions?** Check these docs:
- `SPORTS_SPECIALIZATION_PLAN.md` - Full plan
- `CLAUDE.md` - CLI commands
- `CHANGELOG.md` - Version history
- `FIXES_SUMMARY.md` - Recent optimizations

**Issues?**
- Check logs first: `docker compose -f docker-compose.production.yml logs`
- Check health: `docker compose exec worker pnpm health`
- Restart service: `docker compose restart SERVICE_NAME`

**Emergency rollback:**
```bash
# Stop all services
docker compose -f docker-compose.production.yml down

# Restore from backup
cd backups/postgres
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f ../../docker-compose.production.yml exec -T postgres \
  psql -U sports_user data_module_sports
```

---

## ✅ Success Checklist

After deployment, verify:

- [ ] All 7 Docker containers running
- [ ] PostgreSQL healthy
- [ ] Ingestion fetching sports markets
- [ ] Quotes updating every 15s
- [ ] Matching creating suggestions
- [ ] Watchlist populated
- [ ] Backups configured (cron)
- [ ] Monitoring active
- [ ] No error logs
- [ ] Database has >0 sports markets

**If all checked - you're good to go! 🚀**

---

**Server:** 192.168.1.251
**User:** marmok
**Project:** /opt/data-module
**Deployed:** [DATE]
