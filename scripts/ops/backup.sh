#!/usr/bin/env bash
# Ночная копия базы и загруженных файлов с проверками (решения 118, 216):
#
#   15 3 * * * bash ~/skilllink/app/scripts/ops/backup.sh
#
# Кладёт в ~/backups два файла за ночь, у каждого рядом .sha256:
#   skilllink-ГГГГ-ММ-ДД.dump              — pg_dump -Fc рабочей базы;
#   skilllink-uploads-ГГГГ-ММ-ДД.tar.gz    — том загрузок (файлы к документам и этапам,
#                                            решение 145, /data/uploads в контейнере app).
#
# Копия базы считается снятой, только если:
#   1. pg_dump закончился с кодом 0 — пишется во временный файл, прошлая копия
#      на месте, пока новая не прошла все проверки;
#   2. она больше 1 КБ;
#   3. `pg_restore --list` читает оглавление и в нём есть данные таблиц;
#   4. `pg_restore -f /dev/null` дочитывает её до конца — оглавление лежит в начале
#      файла, и оборванная на середине копия проверку 3 проходит;
#   5. только после этого — переименование на место и .sha256 рядом.
# Архив файлов — так же: tar во временный файл, `tar -tzf` читает его целиком
# (gzip проверяет свою контрольную сумму), потом на место. Пустой том — не ошибка:
# архив из одного каталога.
#
# Сбой — строка «ОШИБКА РЕЗЕРВНОЙ КОПИИ …» в ~/backups/backup.log, код выхода 1 и
# оповещение alert.sh (Telegram владельцу и администраторам): вид `backup` — база,
# `backup-files` — файлы. Telegram из облака бывает недоступен минуту-другую —
# оповещение повторяется до трёх раз. Следующая удачная ночь — «восстановилось ✅».
#
# Срок хранения — 14 суток, вместе с .sha256; старые копии удаляются, только когда
# свежая этого вида снялась: неделя сбоев не должна стереть последние исправные копии.
# В облако обе копии уносит backup-offsite.sh (решение 114), по-настоящему базу
# восстанавливает и архив файлов читает еженедельный restore-drill.sh.
#
# Настройки окружения (для проверки на своей машине — scripts/ops/backup.test.sh):
#   BACKUP_DIR, PG_CONTAINER, DB_USER, DB_NAME, PG_BIN  — как у offsite-lib.sh;
#   UPLOADS_VOLUME     том загрузок (по умолчанию skilllink_skilllink-uploads — имя,
#                      которое даёт docker compose -p skilllink);
#   UPLOADS_SRC        вместо тома — каталог на этой машине;
#   UPLOADS_TAR_IMAGE  образ, в котором tar читает том (postgres:16-alpine — уже есть
#                      на сервере, ничего не скачивается).
set -uo pipefail
set +x
umask 077

# Журнал — раньше всего, что может упасть: cron запускает скрипт без перенаправления,
# и всё, что напечатано до него, пропадает (почты на сервере нет).
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups}
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

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh" || {
  printf '%s ОШИБКА РЕЗЕРВНОЙ КОПИИ: не читается %s/ops-lib.sh — копия не снималась\n' \
    "$(date '+%F %T')" "$(dirname "$0")"
  exit 1
}

KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
MIN_BYTES=1024
UPLOADS_VOLUME=${UPLOADS_VOLUME:-${COMPOSE_PROJECT}_skilllink-uploads}
UPLOADS_TAR_IMAGE=${UPLOADS_TAR_IMAGE:-postgres:16-alpine}
ALERT_ATTEMPTS=${ALERT_ATTEMPTS:-3}
ALERT_RETRY_PAUSE_S=${ALERT_RETRY_PAUSE_S:-30}

if command -v flock > /dev/null; then
  exec 9> "$BACKUP_DIR/.backup.lock"
  flock -n 9 || { say "предыдущая копия ещё снимается — пропускаю"; exit 0; }
fi

# Остатки прерванного запуска (kill -9, перезагрузка) — это персональные данные.
find "$BACKUP_DIR" -maxdepth 1 \( -name '.backup-work.*' -o -name '.skilllink-*.partial' -o -name '.backup-err.*' \) \
  -mmin +120 -exec rm -rf {} + 2> /dev/null || true

WORK=$(mktemp -d "$BACKUP_DIR/.backup-work.XXXXXX") || {
  say "ОШИБКА РЕЗЕРВНОЙ КОПИИ: не создать временный каталог в $BACKUP_DIR (место на диске?)"
  exit 1
}
trap 'rm -rf "$WORK"' EXIT

day=$(date +%F)
DB_FILE="skilllink-$day.dump"
FILES_FILE="skilllink-uploads-$day.tar.gz"

# Оповещение с повтором: alert.sh возвращает 3, если Telegram не принял ни одному
# получателю (сеть), — тогда пауза и ещё попытка. 0 — отправлено, подавлено как повтор
# или бот не настроен.
notify() {
  local attempt=1 code
  while :; do
    bash "$OPS_DIR/alert.sh" "$@"
    code=$?
    [ "$code" = 3 ] || break
    [ "$attempt" -lt "$ALERT_ATTEMPTS" ] || break
    attempt=$((attempt + 1))
    sleep "$ALERT_RETRY_PAUSE_S"
  done
  [ "$code" = 0 ] || say "оповещение «$1 $2» не доставлено (код $code, попыток $attempt) — $ALERT_DIR/alerts.log"
}

first_line() { head -c 300 "$1" 2> /dev/null | tr '\n' ' '; }

# Файл и его .sha256 — на место из временного каталога (тот же диск: mv атомарен).
put_in_place() {
  local name=$1
  printf '%s  %s\n' "$(sha256_of "$WORK/$name")" "$name" > "$WORK/$name.sha256" &&
    mv -f "$WORK/$name" "$BACKUP_DIR/$name" &&
    mv -f "$WORK/$name.sha256" "$BACKUP_DIR/$name.sha256"
}

DB_ERROR=""
DB_NOTE=""
backup_db() {
  local partial="$WORK/$DB_FILE" err="$WORK/db.err" code size tables

  # pg_dump — в контейнере базы (на сервере ничего не ставится) или локальный (PG_BIN).
  if [ -n "${PG_BIN:-}" ]; then
    "$PG_BIN/pg_dump" -Fc -U "$DB_USER" "$DB_NAME" > "$partial" 2> "$err"
  else
    docker exec -i "$PG_CONTAINER" pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$partial" 2> "$err"
  fi
  code=$?
  if [ "$code" -ne 0 ]; then
    DB_ERROR="pg_dump завершился с кодом $code: $(first_line "$err")"
    return 1
  fi

  size=$(size_of "$partial")
  if [ "$size" -lt "$MIN_BYTES" ]; then
    DB_ERROR="pg_dump вернул $size байт — меньше 1 КБ, в копии нет данных"
    return 1
  fi

  if ! pg_tool pg_restore --list < "$partial" > "$WORK/db.toc" 2> "$err"; then
    DB_ERROR="pg_restore --list не читает копию: $(first_line "$err")"
    return 1
  fi
  tables=$(grep -c ' TABLE DATA ' "$WORK/db.toc" || true)
  if [ "${tables:-0}" -eq 0 ]; then
    DB_ERROR="в копии нет данных ни одной таблицы"
    return 1
  fi

  if ! pg_tool pg_restore -f /dev/null < "$partial" 2> "$err"; then
    DB_ERROR="копия оборвана или повреждена — pg_restore не дочитал её: $(first_line "$err")"
    return 1
  fi

  if ! put_in_place "$DB_FILE"; then
    DB_ERROR="не удалось положить копию в $BACKUP_DIR/$DB_FILE (место на диске?)"
    return 1
  fi

  # Отметка для метрик сервера (решение 137): `backup_last_success_timestamp_seconds`
  # и `backup_last_size_bytes` в /api/metrics читают этот файл через переменную
  # BACKUP_STATUS_FILE в контейнере приложения (docs/DEPLOY.md, раздел 12).
  # Не смертельно, если не записалась.
  printf '{"timestamp": %s, "sizeBytes": %s}' "$(date +%s)" "$size" > "$BACKUP_DIR/last.json" 2> /dev/null || true
  DB_NOTE="$DB_FILE, $(human_size "$size"), таблиц с данными: $tables"
}

FILES_ERROR=""
FILES_NOTE=""
backup_files() {
  local partial="$WORK/$FILES_FILE" err="$WORK/files.err" code size count

  if [ -n "${UPLOADS_SRC:-}" ]; then
    if [ ! -d "$UPLOADS_SRC" ]; then
      FILES_ERROR="нет каталога загрузок $UPLOADS_SRC"
      return 1
    fi
    tar -czf - -C "$UPLOADS_SRC" . > "$partial" 2> "$err"
  else
    if ! docker volume inspect "$UPLOADS_VOLUME" > /dev/null 2> "$err"; then
      FILES_ERROR="нет тома $UPLOADS_VOLUME: $(first_line "$err")"
      return 1
    fi
    # Том — только на чтение, контейнер без сети; tar пишет архив в stdout,
    # файл создаёт этот скрипт — с правами 600 владельца сервера.
    docker run --rm --network none --memory 256m --entrypoint tar \
      -v "$UPLOADS_VOLUME:/src:ro" "$UPLOADS_TAR_IMAGE" -czf - -C /src . > "$partial" 2> "$err"
  fi
  code=$?
  if [ "$code" -ne 0 ]; then
    FILES_ERROR="tar завершился с кодом $code: $(first_line "$err")"
    return 1
  fi

  if ! tar -tzf "$partial" > "$WORK/files.list" 2> "$err"; then
    FILES_ERROR="архив не читается (tar -tzf): $(first_line "$err")"
    return 1
  fi
  count=$(grep -v '/$' "$WORK/files.list" | grep -c . || true)
  size=$(size_of "$partial")

  if ! put_in_place "$FILES_FILE"; then
    FILES_ERROR="не удалось положить архив в $BACKUP_DIR/$FILES_FILE (место на диске?)"
    return 1
  fi
  FILES_NOTE="$FILES_FILE, $(human_size "$size"), файлов: $count"
  [ "$count" -gt 0 ] || FILES_NOTE="$FILES_NOTE (том пуст — это не ошибка)"
}

# Копии старше срока — только того вида, что сегодня снялся.
expire() {
  find "$BACKUP_DIR" -maxdepth 1 \( -name "$1" -o -name "$1.sha256" \) -mtime +"$KEEP_DAYS" -delete 2> /dev/null || true
}

started=$(now_ms)
say "── копия за $day: начало"
status=0

if backup_db; then
  expire 'skilllink-[0-9]*.dump'
  count=$(find "$BACKUP_DIR" -maxdepth 1 -name 'skilllink-[0-9]*.dump' | wc -l | tr -d ' ')
  say "ГОТОВО: база — $DB_NOTE; копий базы на машине: $count"
  notify backup ok "ночная копия базы снова снимается: $DB_NOTE"
else
  status=1
  say "ОШИБКА РЕЗЕРВНОЙ КОПИИ БАЗЫ: $DB_ERROR. Прошлые копии не тронуты"
  notify backup critical "ОШИБКА РЕЗЕРВНОЙ КОПИИ БАЗЫ: $DB_ERROR. Прошлые копии не тронуты. Журнал: $LOG_FILE"
fi

if backup_files; then
  expire 'skilllink-uploads-*.tar.gz'
  count=$(find "$BACKUP_DIR" -maxdepth 1 -name 'skilllink-uploads-*.tar.gz' | wc -l | tr -d ' ')
  say "ГОТОВО: файлы — $FILES_NOTE; архивов на машине: $count"
  notify backup-files ok "архив загруженных файлов снова снимается: $FILES_NOTE"
else
  status=1
  say "ОШИБКА РЕЗЕРВНОЙ КОПИИ ФАЙЛОВ: $FILES_ERROR. Прошлые архивы не тронуты"
  notify backup-files critical "ОШИБКА РЕЗЕРВНОЙ КОПИИ ФАЙЛОВ: $FILES_ERROR. Прошлые архивы не тронуты. Журнал: $LOG_FILE"
fi

elapsed=$(( ($(now_ms) - started) / 1000 ))
if [ "$status" -eq 0 ]; then
  say "── копия за $day: готово, $elapsed с"
else
  say "── копия за $day: ОШИБКА РЕЗЕРВНОЙ КОПИИ, $elapsed с (код 1)"
fi
exit "$status"
