#!/usr/bin/env bash
# Сторож стенда (решение 118). Cron владельца сервера, каждые 5 минут:
#
#   */5 * * * * bash ~/skilllink/app/scripts/ops/watchdog.sh
#
# Проверки — каждая сама по себе, сбой одной не мешает остальным:
#   ready        /api/ready через Caddy не 200 два раза подряд (одна потерянная
#                проверка — ещё не падение);
#   containers   база, приложение или Caddy не запущены или unhealthy;
#   restart-*    контейнер перезапускался с прошлой проверки (упал и поднялся сам —
#                без сторожа этого никто бы не заметил);
#   disk         занято больше 85% (95% — critical);
#   backup-age   самая свежая ночная копия старше 26 ч или меньше 1 КБ;
#   tls          сертификат истекает меньше чем через 14 дней (3 — critical);
#   schema       код старше схемы базы (/api/ready: schema=ahead) — после отката;
#   audit-chain  цепочка журнала действий разорвана (npm run audit:verify, раз в час;
#                если такого скрипта в package.json нет — пропуск с пометкой).
# О каждой проблеме — один раз (scripts/ops/alert.sh: маркер, напоминание раз в 6 ч),
# когда прошла — «восстановилось ✅».
#
# Раз в сутки после 09:00 МСК — сводка: аптайм, место, возраст копии, открытые
# проблемы, печать журнала (headSeq/headHash из npm run audit:seal, если он есть).
#
# Заморозка после сдачи (STAND_FREEZE_AT в .env.cloud, решение 147, docs/DEPLOY.md,
# «Заморозка после сдачи»): после неё сторож продолжает все проверки и оповещения
# как обычно, но не снимает печать журнала (audit:seal — запись в audit_seals)
# и проверяет цепочку без записи исхода в журнал (audit:verify --no-audit).
# Сам сторож в базу стенда не пишет и ничего не перезапускает ни до, ни после.
#
# Журнал — ~/skilllink/alerts/watchdog.log (последние 2000 строк).
# Переопределяется окружением для проверки на своей машине (docs/OPERATIONS_TESTS.md):
#   READY_URL, RESOLVE, CONTAINERS, DISK_PATH, TLS_CONNECT, TLS_NAME, AUDIT_CMD, SUMMARY_HOUR,
#   NOW_OVERRIDE (секунды с эпохи — проверка STAND_FREEZE_AT без ожидания даты, scripts/ops/freeze.test.sh).
set -uo pipefail
set +x
umask 077

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

ALERT="$OPS_DIR/alert.sh"
mkdir -p "$ALERT_DIR"
LOG_FILE=${WATCHDOG_LOG:-$ALERT_DIR/watchdog.log}
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 5000 ]; then
  tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

# Два запуска не накладываются: медленная проверка не должна плодить сторожей.
if command -v flock > /dev/null; then
  exec 9> "$ALERT_DIR/.watchdog.lock"
  flock -n 9 || { say "предыдущий запуск ещё идёт — пропускаю"; exit 0; }
fi

DISK_WARN=${DISK_WARN:-85}
DISK_CRIT=${DISK_CRIT:-95}
BACKUP_MAX_AGE_H=${BACKUP_MAX_AGE_H:-26}
TLS_WARN_DAYS=${TLS_WARN_DAYS:-14}
TLS_CRIT_DAYS=${TLS_CRIT_DAYS:-3}
SUMMARY_HOUR=${SUMMARY_HOUR:-9}
CONTAINERS=${CONTAINERS:-"$PG_CONTAINER $APP_CONTAINER $CADDY_CONTAINER"}

PROBLEMS=()
fire() {
  PROBLEMS+=("$1: $3")
  say "ПРОБЛЕМА $1 ($2): $3"
  bash "$ALERT" "$1" "$2" "$3" || say "оповещение $1 не доставлено (код $?)"
}
settle() { bash "$ALERT" "$1" ok "$2" || true; }
setting() { [ -r "$ENV_FILE" ] && env_get "$1"; }

# Заморозка после сдачи (STAND_FREEZE_AT в .env.cloud, решение 147, docs/DEPLOY.md):
# после неё сторож только проверяет и оповещает, ничего не пишет в базу стенда и
# ничего не перезапускает сам (и без заморозки он этого не делал — см. DEPLOY.md).
FREEZE_AT=$(setting STAND_FREEZE_AT)

# ── Куда стучаться ──────────────────────────────────────────────────────────
# Через Caddy на этой же машине: снаружи к своему публичному адресу из облака
# можно и не достучаться, а с --resolve проверяется всё то же — Caddy, его
# сертификат и приложение за ним.
PUBLIC_URL=$(setting DOCKER_AUTH_URL)
SITE_HOST=$(printf '%s' "$PUBLIC_URL" | sed -nE 's#^https://([^/:]+).*#\1#p')
if [ -z "${READY_URL:-}" ]; then
  if [ -n "$SITE_HOST" ]; then
    READY_URL="https://$SITE_HOST/api/ready"
    RESOLVE=${RESOLVE:-"$SITE_HOST:443:127.0.0.1"}
  else
    port=$(setting HTTP_PORT || true)
    READY_URL="http://127.0.0.1${port:+:$port}/api/ready"
  fi
fi
export RESOLVE

# ── ready ───────────────────────────────────────────────────────────────────
READY_BODY=$(mktemp)
trap 'rm -f "$READY_BODY"' EXIT
READY_CODE=$(http_code "$READY_URL" "$READY_BODY")
code=$READY_CODE
fails_file="$ALERT_DIR/ready.fails"
READY_LATENCY=$(sed -nE 's/.*"latencyMs":([0-9.]+).*/\1/p' "$READY_BODY")
if [ "$code" = 200 ]; then
  rm -f "$fails_file"
  settle ready "/api/ready снова отвечает 200${READY_LATENCY:+, база за $READY_LATENCY мс}"
  if grep -q '"schema":"ahead"' "$READY_BODY"; then
    fire schema warning "в базе миграция новее, чем в коде (откат кода?): $(sed -nE 's/.*"applied":"([^"]+)".*/\1/p' "$READY_BODY")"
  else
    settle schema "код и схема базы снова совпадают"
  fi
else
  n=$(( $(cat "$fails_file" 2> /dev/null || echo 0) + 1 ))
  echo "$n" > "$fails_file"
  reason=$(sed -nE 's/.*"reason":"([a-z-]+)".*/\1/p' "$READY_BODY")
  [ "$code" = 000 ] && code="нет ответа"
  if [ "$n" -ge 2 ]; then
    fire ready critical "/api/ready через Caddy: $code${reason:+ ($reason)} — $n проверки подряд. Что делать: docs/DEPLOY.md, «Если что-то не так»"
  else
    say "ready: $code${reason:+ ($reason)} — первая неудача, жду следующей проверки"
  fi
fi

# ── containers, restart-* ───────────────────────────────────────────────────
bad=()
for name in $CONTAINERS; do
  info=$(docker inspect -f '{{.State.Status}} {{with index .State "Health"}}{{.Status}}{{else}}-{{end}} {{.RestartCount}} {{.Id}}/{{.State.StartedAt}}' "$name" 2> /dev/null) || info="missing - 0 -"
  # У Caddy нет healthcheck — поля Health нет вовсе, отсюда index, а не .State.Health.
  read -r status health restarts started <<< "$info"
  if [ "$status" != running ]; then
    bad+=("$name: $status")
  elif [ "$health" = unhealthy ]; then
    bad+=("$name: unhealthy")
  fi
  # Перезапуск: тот же контейнер, другое время старта. Выкладка пересоздаёт
  # контейнер (другой id) — это не перезапуск. `docker restart` вручную сюда
  # попадёт — поэтому это сообщение, а не тревога.
  state_file="$ALERT_DIR/.started.$name"
  previous=$(cat "$state_file" 2> /dev/null || true)
  if [ "$status" = running ] && [ "${previous%%/*}" = "${started%%/*}" ] && [ "$previous" != "$started" ]; then
    bash "$ALERT" "restart-${name#skilllink-}" info "контейнер $name перезапускался (перезапусков по политике: $restarts). Журнал: docker logs --tail 50 $name" || true
    say "контейнер $name перезапускался"
  fi
  [ "$status" = running ] && echo "$started" > "$state_file"
done
if [ "${#bad[@]}" -gt 0 ]; then
  fire containers critical "$(IFS=';'; echo "${bad[*]}")"
else
  settle containers "все контейнеры запущены и здоровы"
fi

# ── disk ────────────────────────────────────────────────────────────────────
DISK_PATH=${DISK_PATH:-/}
used=$(df -P "$DISK_PATH" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
free_h=$(df -Ph "$DISK_PATH" | awk 'NR == 2 { print $4 }')
if [ -n "$used" ] && [ "$used" -ge "$DISK_CRIT" ]; then
  fire disk critical "занято $used% на $DISK_PATH, свободно $free_h. Почистить: docker system prune -af (тома с данными не трогает)"
elif [ -n "$used" ] && [ "$used" -ge "$DISK_WARN" ]; then
  fire disk warning "занято $used% на $DISK_PATH, свободно $free_h"
else
  settle disk "занято ${used:-?}% на $DISK_PATH, свободно $free_h"
fi

# ── backup-age ──────────────────────────────────────────────────────────────
latest=$(latest_backup)
BACKUP_NOTE="копий нет"
if [ -z "$latest" ]; then
  fire backup-age critical "в $BACKUP_DIR нет ни одной ночной копии skilllink-*.dump"
else
  age=$(age_seconds "$latest")
  size=$(size_of "$latest")
  BACKUP_NOTE="$(basename "$latest"), $(human_size "$size"), $(human_duration "$age") назад"
  if [ "$age" -gt $((BACKUP_MAX_AGE_H * 3600)) ]; then
    fire backup-age critical "последняя копия $BACKUP_NOTE — старше $BACKUP_MAX_AGE_H ч: ночная копия не снялась ($BACKUP_DIR/backup.log)"
  elif [ "$size" -lt 1024 ]; then
    fire backup-age critical "последняя копия $BACKUP_NOTE — меньше 1 КБ, она пустая"
  else
    settle backup-age "свежая копия: $BACKUP_NOTE"
  fi
fi

# ── tls ─────────────────────────────────────────────────────────────────────
TLS_NAME=${TLS_NAME:-$SITE_HOST}
TLS_NOTE=""
if [ -n "$TLS_NAME" ]; then
  TLS_CONNECT=${TLS_CONNECT:-127.0.0.1:443}
  cert=$(echo | with_timeout 15 openssl s_client -connect "$TLS_CONNECT" -servername "$TLS_NAME" 2> /dev/null |
    openssl x509 2> /dev/null)
  if [ -z "$cert" ]; then
    fire tls critical "не удалось получить сертификат $TLS_NAME с $TLS_CONNECT — Caddy не отвечает по HTTPS"
  else
    end=$(printf '%s\n' "$cert" | openssl x509 -noout -enddate | cut -d= -f2)
    TLS_NOTE="сертификат до $end"
    if ! printf '%s\n' "$cert" | openssl x509 -noout -checkend $((TLS_CRIT_DAYS * 86400)) > /dev/null; then
      fire tls critical "сертификат $TLS_NAME истекает меньше чем через $TLS_CRIT_DAYS дн. ($end) — смотрите журнал Caddy"
    elif ! printf '%s\n' "$cert" | openssl x509 -noout -checkend $((TLS_WARN_DAYS * 86400)) > /dev/null; then
      fire tls warning "сертификат $TLS_NAME истекает меньше чем через $TLS_WARN_DAYS дн. ($end): Caddy обычно продлевает за 30 — не продлил"
    else
      settle tls "сертификат $TLS_NAME продлён: до $end"
    fi
  fi
fi

# ── audit-chain (раз в час) ─────────────────────────────────────────────────
# Цепочка журнала действий (решение 115): `npm run audit:verify` выходит с кодом 1 при
# разрыве. Скрипт живёт в образе migrate, запуск — отдельный контейнер на десяток
# секунд, поэтому не каждые 5 минут, а раз в час.
COMPOSE="docker compose -p $COMPOSE_PROJECT -f docker-compose.yml -f deploy/yandex-cloud/compose.cloud.yml --env-file $ENV_FILE"
has_script() { grep -q "\"$1\":" "$APP_DIR/package.json" 2> /dev/null; }
audit_stamp="$ALERT_DIR/.audit-verify"
if [ -z "${AUDIT_CMD:-}" ] && ! has_script audit:verify; then
  AUDIT_NOTE="не проверялась: audit:verify нет в package.json"
elif [ -f "$audit_stamp" ] && [ "$(age_seconds "$audit_stamp")" -lt 3300 ]; then
  AUDIT_NOTE="проверена $(human_duration "$(age_seconds "$audit_stamp")") назад"
else
  touch "$audit_stamp"
  # После заморозки — без записи в журнал (--no-audit, уже есть в audit-chain.ts):
  # проверка остаётся, запись своего же исхода в audit_log — нет. Через npm run
  # аргумент передаётся после «--»; при своём AUDIT_CMD (проверка на машине,
  # без npm) — без «--».
  no_log_flag=""
  if is_frozen "$FREEZE_AT"; then
    if [ -n "${AUDIT_CMD:-}" ]; then no_log_flag=" --no-audit"; else no_log_flag=" -- --no-audit"; fi
  fi
  out=$(cd "$APP_DIR" && with_timeout 300 ${AUDIT_CMD:-$COMPOSE --profile migrate run --rm -T migrate npm run -s audit:verify}$no_log_flag 2>&1)
  code=$?
  last=$(printf '%s\n' "$out" | grep -v '^\s*$' | tail -n 1 | cut -c1-200)
  case $code in
    0)
      AUDIT_NOTE="цела"
      settle audit-chain "цепочка журнала действий цела"
      settle audit-check "проверка цепочки журнала снова выполняется"
      ;;
    1)
      AUDIT_NOTE="РАЗОРВАНА"
      fire audit-chain critical "цепочка журнала действий разорвана: $last"
      ;;
    *)
      AUDIT_NOTE="проверка не выполнилась (код $code)"
      fire audit-check warning "проверка цепочки журнала не выполнилась (код $code): $last"
      ;;
  esac
fi

# ── Сводка раз в сутки ──────────────────────────────────────────────────────
DRILLS_LOG=${DRILLS_LOG:-$HOME/skilllink/drills.log}
today=$(TZ=Europe/Moscow date +%F)
hour=$(TZ=Europe/Moscow date +%H)
summary_stamp="$ALERT_DIR/.summary-$today"
if [ "$((10#$hour))" -ge "$SUMMARY_HOUR" ] && [ ! -f "$summary_stamp" ]; then
  touch "$summary_stamp"
  find "$ALERT_DIR" -name '.summary-*' -mtime +7 -delete 2> /dev/null || true

  open_now=""
  for marker in "$ALERT_DIR"/*.firing; do
    [ -f "$marker" ] && open_now="$open_now $(basename "$marker" .firing)"
  done
  uptime_note=$(uptime -p 2> /dev/null || uptime | sed -E 's/^.*up +([^,]+),.*/\1/')

  # Печать журнала (решение 115): последний номер и хеш цепочки. Кто сохранил её
  # у себя, потом докажет, что журнал до этого места не переписан.
  #
  # После заморозки (решение 147, docs/DEPLOY.md) — не снимается: сама печать
  # пишет строку в audit_seals, а после сдачи в базу стенда ничего не пишется.
  if is_frozen "$FREEZE_AT"; then
    SEAL_NOTE="пропущена — заморозка после сдачи (STAND_FREEZE_AT=$FREEZE_AT)"
  elif [ -n "${AUDIT_SEAL_CMD:-}" ] || has_script audit:seal; then
    seal=$(cd "$APP_DIR" && with_timeout 300 ${AUDIT_SEAL_CMD:-$COMPOSE --profile migrate run --rm -T migrate npm run -s audit:seal} 2>&1)
    head_seq=$(printf '%s' "$seal" | grep -oE '"?headSeq"?[": =]+[0-9]+' | grep -oE '[0-9]+$' | tail -n 1)
    head_hash=$(printf '%s' "$seal" | grep -oE '"?headHash"?[": =]+"?[0-9a-fA-F]{16,}' | grep -oE '[0-9a-fA-F]{16,}$' | tail -n 1)
    if [ -n "$head_seq" ] && [ -n "$head_hash" ]; then
      SEAL_NOTE="headSeq=$head_seq, headHash=$head_hash"
    else
      SEAL_NOTE="audit:seal не дал headSeq/headHash: $(printf '%s\n' "$seal" | tail -n 1 | cut -c1-120)"
    fi
  else
    SEAL_NOTE="нет: audit:seal нет в package.json"
  fi
  drill_note=$(tail -n 1 "$DRILLS_LOG" 2> /dev/null | cut -c1-200)

  if [ -z "$open_now" ]; then headline="✅ всё в порядке"; else headline="⚠️ открыто:$open_now"; fi
  summary="$headline
аптайм машины: ${uptime_note:-?}
диск $DISK_PATH: занято ${used:-?}%, свободно ${free_h:-?}
копия базы: $BACKUP_NOTE
/api/ready: $READY_CODE${READY_LATENCY:+, база за $READY_LATENCY мс}${TLS_NOTE:+
$TLS_NOTE}
цепочка журнала: ${AUDIT_NOTE:-?}
печать журнала: $SEAL_NOTE
учения по восстановлению: ${drill_note:-ещё не проводились}"
  bash "$ALERT" summary info "$summary" || say "сводка не доставлена"
  say "сводка за $today отправлена"
fi

say "проверено: ready=$READY_CODE, диск ${used:-?}%, копия: $BACKUP_NOTE, проблем: ${#PROBLEMS[@]}"
