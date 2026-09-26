# Общее для scripts/ops/*.sh (решение 118). Сам не запускается — подключается через source.
#
# Чтение настроек (env_get), psql/pg_restore в контейнере базы (pg_tool), размеры и
# контрольные суммы берутся из scripts/deploy/offsite-lib.sh — одна реализация на всё.
# Секреты нигде не печатаются.
# shellcheck shell=bash

set +x

OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/deploy/offsite-lib.sh
. "$OPS_DIR/../deploy/offsite-lib.sh"

# Где сторож и оповещения держат состояние: маркеры «горит», счётчики, журнал.
ALERT_DIR=${ALERT_DIR:-$HOME/skilllink/alerts}
# Каталог с кодом стенда на сервере (deploy.sh кладёт его сюда).
APP_DIR=${APP_DIR:-$HOME/skilllink/app}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-skilllink}
APP_CONTAINER=${APP_CONTAINER:-skilllink-app}
CADDY_CONTAINER=${CADDY_CONTAINER:-skilllink-caddy}
# PG_CONTAINER, DB_USER, DB_NAME, BACKUP_DIR, ENV_FILE — из offsite-lib.sh.

# Текущее время в миллисекундах: bash 5 знает EPOCHREALTIME, на bash 3 (macOS) — perl.
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local t=${EPOCHREALTIME/,/.}
    printf '%s\n' "$(( ${t%.*} * 1000 + 10#$(printf '%.3s' "${t#*.}000") ))"
  else
    perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'
  fi
}

# Секунды с изменения файла: GNU stat на сервере, BSD stat на маке.
mtime_of() { stat -c %Y "$1" 2> /dev/null || stat -f %m "$1"; }
age_seconds() { echo $(( $(date +%s) - $(mtime_of "$1") )); }

# «5 ч 12 мин» из секунд.
human_duration() {
  local s=$1
  if [ "$s" -ge 86400 ]; then
    printf '%d сут %d ч' $((s / 86400)) $((s % 86400 / 3600))
  elif [ "$s" -ge 3600 ]; then
    printf '%d ч %d мин' $((s / 3600)) $((s % 3600 / 60))
  elif [ "$s" -ge 60 ]; then
    printf '%d мин %d с' $((s / 60)) $((s % 60))
  else
    printf '%d с' "$s"
  fi
}

# Текущее время в секундах с эпохи. NOW_OVERRIDE (секунды с эпохи) — для проверки
# заморозки на своей машине без ожидания настоящей даты, как ALERT_DRY_RUN у alert.sh
# (docs/OPERATIONS_TESTS.md); scripts/ops/freeze.test.sh так и делает.
now_epoch() { printf '%s' "${NOW_OVERRIDE:-$(date +%s)}"; }

# ISO 8601 со смещением (2026-09-29T23:59:00+03:00, «Z» тоже понимает) → секунды
# с эпохи. GNU date (сервер, Ubuntu) читает такую строку сама; BSD date (мак) — без
# двоеточия в смещении и без буквы «Z», отсюда нормализация перед %z.
iso_epoch() {
  local iso=$1 bsd
  date -d "$iso" +%s 2> /dev/null && return
  bsd=$(printf '%s' "$iso" | sed -E -e 's/Z$/+0000/' -e 's/([+-][0-9]{2}):([0-9]{2})$/\1\2/')
  date -j -f '%Y-%m-%dT%H:%M:%S%z' "$bsd" +%s 2> /dev/null
}

# Заморозка стенда после сдачи (STAND_FREEZE_AT в .env.cloud, решение 147): пусто,
# не дата или дата ещё не наступила — код 1 (не заморожено); дата уже прошла — код 0.
is_frozen() {
  local freeze_at=$1 freeze_epoch
  [ -n "$freeze_at" ] || return 1
  freeze_epoch=$(iso_epoch "$freeze_at") || return 1
  [ -n "$freeze_epoch" ] || return 1
  [ "$(now_epoch)" -ge "$freeze_epoch" ]
}

# Команда с пределом времени, если есть timeout (на Ubuntu есть всегда).
with_timeout() {
  local seconds=$1
  shift
  if command -v timeout > /dev/null; then timeout "$seconds" "$@"; else "$@"; fi
}

# Самая свежая ночная копия: в имени дата ГГГГ-ММ-ДД, последняя по имени — самая свежая.
latest_backup() {
  local file latest=""
  for file in "$BACKUP_DIR"/skilllink-*.dump; do
    [ -f "$file" ] && latest=$file
  done
  printf '%s' "$latest"
}

# Код ответа адреса; с RESOLVE=host:port:ip — соединение на ip с именем host (как у Caddy).
http_code() {
  local url=$1 out=${2:-/dev/null}
  local resolve=()
  [ -n "${RESOLVE:-}" ] && resolve=(--resolve "$RESOLVE")
  curl -s -o "$out" -w '%{http_code}' --max-time "${HTTP_TIMEOUT:-10}" \
    ${resolve[@]+"${resolve[@]}"} "$url" 2> /dev/null || true
}

# Запрос к рабочей базе, ответ строками без заголовков: psql в контейнере базы или
# локальный из PG_BIN (проверка на своей машине). Не дольше 15 секунд.
psql_query() {
  if [ -n "${PG_BIN:-}" ]; then
    with_timeout 15 "$PG_BIN/psql" -U "$DB_USER" -d "$DB_NAME" -At -v ON_ERROR_STOP=1 -c "$1"
  else
    with_timeout 15 docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -v ON_ERROR_STOP=1 -c "$1"
  fi
}
