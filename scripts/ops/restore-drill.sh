#!/usr/bin/env bash
# Учения по восстановлению (решение 118): раз в неделю по-настоящему восстановить
# последнюю ночную копию и замерить, сколько это заняло.
#
#   bash ~/skilllink/app/scripts/ops/restore-drill.sh [файл.dump]
#   30 4 * * 0 bash ~/skilllink/app/scripts/ops/restore-drill.sh      # cron: воскресенье
#
# Копия, которую ни разу не восстанавливали, — не копия, а надежда. Скрипт:
#   1. берёт самую свежую ~/backups/skilllink-*.dump и сверяет её .sha256, если есть;
#   2. поднимает одноразовый PostgreSQL 16 (`docker run --rm`) в отдельной
#      внутренней сети без выхода наружу и без открытых портов — рабочая база
#      и приложение его не видят, он не видит их;
#   3. восстанавливает копию (`pg_restore --exit-on-error`, без владельцев и прав);
#   4. проверяет: в ключевых таблицах есть строки, а последняя запись журнала
#      действий не старше копии больше чем на DRILL_MAX_STALE_DAYS суток (7) —
#      иначе копия снимается со старой или пустой базы;
#   5. всё удаляет.
#
# Итог — одной строкой в ~/skilllink/drills.log и в Telegram (alert.sh):
#   RTO — фактическое время восстановления: от запуска пустого сервера до проверенной
#         базы (скачивание копии из облака сюда не входит — см. restore-offsite.sh);
#   RPO — возраст копии: столько данных пропало бы, случись авария сейчас.
#
# Код выхода: 0 — восстановлено и проверено; 1 — нет.
# В восстановленной базе персональные данные: контейнер с `--rm` и без тома —
# после учений от неё ничего не остаётся.
set -uo pipefail
set +x
umask 077

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

DRILL_IMAGE=${DRILL_IMAGE:-postgres:16-alpine}
DRILLS_LOG=${DRILLS_LOG:-$HOME/skilllink/drills.log}
MAX_STALE_DAYS=${DRILL_MAX_STALE_DAYS:-7}
# Ключевые таблицы: без строк в них система пуста, даже если восстановление «прошло».
KEY_TABLES=${DRILL_TABLES:-"users universities educational_programs cooperations workflow_stages audit_log"}

mkdir -p "$(dirname "$DRILLS_LOG")"
tag="skilllink-drill-$$"
started_at=$(date '+%F %T')
t0=""

cleanup() {
  docker rm -f "$tag" > /dev/null 2>&1 || true
  docker network rm "$tag" > /dev/null 2>&1 || true
}
trap cleanup EXIT

result() { # итог одной строкой: в журнал учений, на экран и в Telegram
  local status=$1 line=$2
  printf '%s %s %s\n' "$started_at" "$status" "$line" | tee -a "$DRILLS_LOG"
  if [ "$status" = OK ]; then
    bash "$OPS_DIR/alert.sh" restore-drill ok "учения по восстановлению снова проходят" || true
    bash "$OPS_DIR/alert.sh" drill info "учения по восстановлению: $line" || true
  else
    bash "$OPS_DIR/alert.sh" restore-drill critical "учения по восстановлению провалены: $line" || true
  fi
}
failed() {
  result FAIL "$1"
  exit 1
}

# ── 1. Копия ────────────────────────────────────────────────────────────────
dump=${1:-$(latest_backup)}
[ -n "$dump" ] && [ -f "$dump" ] || failed "нет копии: в $BACKUP_DIR ни одной skilllink-*.dump"
name=$(basename "$dump")
size=$(size_of "$dump")
rpo_s=$(age_seconds "$dump")
if [ -f "$dump.sha256" ]; then
  expected=$(cut -d' ' -f1 < "$dump.sha256")
  [ "$(sha256_of "$dump")" = "$expected" ] || failed "$name не совпадает с $name.sha256 — файл испорчен"
  checksum="sha256 сверена"
else
  checksum="без .sha256"
fi
say "учения: $name ($(human_size "$size"), $checksum, возраст $(human_duration "$rpo_s"))"

# ── 2. Пустой сервер в изолированной сети ───────────────────────────────────
t0=$(now_ms)
docker network create --internal "$tag" > /dev/null || failed "не удалось создать сеть $tag"
password=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$password docker run -d --rm --name "$tag" --network "$tag" \
  --memory 512m -e POSTGRES_PASSWORD -e POSTGRES_USER=drill -e POSTGRES_DB=drill \
  "$DRILL_IMAGE" > /dev/null || failed "не удалось запустить $DRILL_IMAGE"
ready=0
for _ in $(seq 1 120); do
  # Образ перезапускает сервер после первичной настройки — ждём, пока примет запрос.
  if docker exec "$tag" psql -U drill -d drill -Atc 'select 1' > /dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = 1 ] || failed "одноразовый PostgreSQL не поднялся за минуту"
t_server=$(now_ms)

# ── 3. Восстановление ───────────────────────────────────────────────────────
err=$(mktemp)
if ! docker exec -i "$tag" pg_restore --exit-on-error --no-owner --no-privileges -U drill -d drill < "$dump" 2> "$err"; then
  msg=$(head -c 300 "$err" | tr '\n' ' ')
  rm -f "$err"
  failed "$name не восстановилась: $msg"
fi
rm -f "$err"
t_restored=$(now_ms)

# ── 4. Проверка данных ──────────────────────────────────────────────────────
counts=""
for table in $KEY_TABLES; do
  n=$(docker exec "$tag" psql -U drill -d drill -Atc "select count(*) from \"$table\"" 2> /dev/null) ||
    failed "в восстановленной базе нет таблицы $table"
  [ "${n:-0}" -gt 0 ] || failed "таблица $table пуста — копия снята с пустой базы"
  counts="$counts $table=$n"
done
# Свежесть: последняя запись журнала действий относительно времени копии.
last_audit=$(docker exec "$tag" psql -U drill -d drill -Atc \
  "select coalesce(extract(epoch from max(created_at))::bigint, 0) from audit_log")
dump_time=$(mtime_of "$dump")
stale_s=$((dump_time - ${last_audit:-0}))
[ "$stale_s" -lt 0 ] && stale_s=0
[ "$stale_s" -le $((MAX_STALE_DAYS * 86400)) ] ||
  failed "последняя запись журнала на $(human_duration "$stale_s") старше копии (порог $MAX_STALE_DAYS сут) — копия снята не с рабочей базы?"
tables_total=$(docker exec "$tag" psql -U drill -d drill -Atc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
t_done=$(now_ms)

rto_ms=$((t_done - t0))
line=$(printf 'RTO=%s (сервер %s, восстановление %s, проверка %s) RPO=%s копия=%s %s таблиц=%s%s, журнал: последняя запись за %s до копии' \
  "$(awk -v m="$rto_ms" 'BEGIN { printf "%.1f с", m / 1000 }')" \
  "$(awk -v m="$((t_server - t0))" 'BEGIN { printf "%.1f с", m / 1000 }')" \
  "$(awk -v m="$((t_restored - t_server))" 'BEGIN { printf "%.1f с", m / 1000 }')" \
  "$(awk -v m="$((t_done - t_restored))" 'BEGIN { printf "%.1f с", m / 1000 }')" \
  "$(human_duration "$rpo_s")" "$name" "$(human_size "$size")" "$tables_total" "$counts" \
  "$(human_duration "$stale_s")")
result OK "$line"
