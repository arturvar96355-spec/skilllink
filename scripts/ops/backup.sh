#!/usr/bin/env bash
# Ночная копия базы с проверками (решение 118). Заменяет прежнюю строку cron
# (docs/DEPLOY.md, раздел 6) — то же время, то же имя файла, тот же срок хранения:
#
#   15 3 * * * bash ~/skilllink/app/scripts/ops/backup.sh
#
# Прежняя строка писала pg_dump в файл перенаправлением: упал pg_dump — файл всё
# равно есть, пустой или оборванный, и об этом никто не узнаёт до дня, когда
# копия понадобится. Теперь копия считается снятой, только если:
#   1. pg_dump закончился успешно — пишется во временный файл, на место встаёт в конце;
#   2. она больше 1 КБ;
#   3. `pg_restore --list` читает её оглавление;
#   4. рядом лежит .sha256 — по нему restore-drill.sh и восстановление отличают
#      испорченный файл от исправного.
# Провал — alert.sh backup critical (в Telegram), причина — в ~/backups/backup.log.
# Следующая удачная ночь — «восстановилось ✅».
#
# Копии старше 14 суток удаляются вместе с .sha256. Целиком (все данные до конца)
# копию дочитывает backup-offsite.sh перед отправкой в облако (решение 114),
# а восстанавливает по-настоящему — еженедельный restore-drill.sh.
set -uo pipefail
set +x
umask 077

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
MIN_BYTES=1024
LOG_FILE=${BACKUP_LOG:-$BACKUP_DIR/backup.log}

mkdir -p "$BACKUP_DIR"
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 5000 ]; then
  tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

if command -v flock > /dev/null; then
  exec 9> "$BACKUP_DIR/.backup.lock"
  flock -n 9 || { say "предыдущая копия ещё снимается — пропускаю"; exit 0; }
fi

name="skilllink-$(date +%F).dump"
final="$BACKUP_DIR/$name"
partial="$BACKUP_DIR/.$name.partial"
err=$(mktemp "$BACKUP_DIR/.backup-err.XXXXXX")
trap 'rm -f "$partial" "$err"' EXIT

broken() {
  say "СБОЙ: $1"
  bash "$OPS_DIR/alert.sh" backup critical "ночная копия базы не снята: $1. Журнал: $LOG_FILE" || true
  exit 1
}

started=$(now_ms)
say "── копия $name: начало"

# 1. pg_dump — в контейнере базы (на сервере ничего не ставится) или локальный (PG_BIN).
if [ -n "${PG_BIN:-}" ]; then
  "$PG_BIN/pg_dump" -Fc -U "$DB_USER" "$DB_NAME" > "$partial" 2> "$err"
else
  docker exec -i "$PG_CONTAINER" pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$partial" 2> "$err"
fi
code=$?
[ "$code" -eq 0 ] || broken "pg_dump завершился с кодом $code: $(head -c 300 "$err" | tr '\n' ' ')"

# 2. Размер.
size=$(size_of "$partial")
[ "$size" -ge "$MIN_BYTES" ] || broken "копия $size байт — меньше 1 КБ, в ней нет данных"

# 3. Оглавление читается.
tables=$(pg_tool pg_restore --list < "$partial" 2> "$err" | grep -c ' TABLE DATA ' || true)
[ "${tables:-0}" -gt 0 ] || broken "pg_restore --list не читает копию: $(head -c 300 "$err" | tr '\n' ' ')"

# 4. На место и контрольная сумма рядом.
mv -f "$partial" "$final" || broken "не удалось переименовать копию в $final"
(cd "$BACKUP_DIR" && printf '%s  %s\n' "$(sha256_of "$name")" "$name" > "$name.sha256") ||
  broken "не удалось записать $name.sha256"

# Отметка для метрик сервера (решение 137): `backup_last_success_timestamp_seconds`
# и `backup_last_size_bytes` в /api/metrics читают этот файл через переменную
# BACKUP_STATUS_FILE в контейнере приложения (путь и монтирование — на решение
# владельца, docs/DEPLOY.md, раздел 10). Не смертельно, если не записалась.
printf '{"timestamp": %s, "sizeBytes": %s}' "$(date +%s)" "$size" > "$BACKUP_DIR/last.json" 2> /dev/null || true

# Срок хранения — вместе с контрольными суммами.
find "$BACKUP_DIR" -maxdepth 1 \( -name 'skilllink-*.dump' -o -name 'skilllink-*.dump.sha256' \) \
  -mtime +"$KEEP_DAYS" -delete 2> /dev/null || true
count=$(find "$BACKUP_DIR" -maxdepth 1 -name 'skilllink-*.dump' | wc -l | tr -d ' ')

elapsed=$(( ($(now_ms) - started) / 1000 ))
say "ГОТОВО: $name, $(human_size "$size"), таблиц с данными: $tables, $elapsed с; копий на машине: $count"
bash "$OPS_DIR/alert.sh" backup ok "ночная копия снова снимается: $name, $(human_size "$size")" || true
