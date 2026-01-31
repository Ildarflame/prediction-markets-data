#!/bin/bash
# Daily backup script for Data Module Sports database

set -e

BACKUP_DIR="./backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="data_module_sports"
DB_USER="sports_user"
RETENTION_DAYS=7

echo "🔄 Starting database backup: $DATE"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Backup database
echo "📦 Creating database dump..."
docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump -U $DB_USER $DB_NAME | gzip > "$BACKUP_DIR/backup_$DATE.sql.gz"

# Check if backup was created successfully
if [ -f "$BACKUP_DIR/backup_$DATE.sql.gz" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/backup_$DATE.sql.gz" | cut -f1)
    echo "✅ Backup complete: backup_$DATE.sql.gz ($BACKUP_SIZE)"
else
    echo "❌ Backup failed!"
    exit 1
fi

# Remove backups older than RETENTION_DAYS
echo "🧹 Cleaning up old backups (keeping last $RETENTION_DAYS days)..."
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Count remaining backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | wc -l)
echo "📊 Total backups: $BACKUP_COUNT"

# List recent backups
echo ""
echo "Recent backups:"
ls -lh "$BACKUP_DIR"/backup_*.sql.gz | tail -5

echo ""
echo "✅ Backup process complete!"
