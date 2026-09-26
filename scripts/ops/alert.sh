#!/usr/bin/env bash
# Оповещение владельцу в Telegram из скриптов сервера (решение 118).
#
#   bash scripts/ops/alert.sh <вид> <важность> <текст>
#
#   bash scripts/ops/alert.sh disk warning "занято 87% на /"
#   bash scripts/ops/alert.sh disk ok "занято 60% на /"
#
# <вид>       — латиница, цифры и дефис: ready, disk, backup, containers…
# <важность>:
#   critical, warning — «горит». Первый раз — сообщение и маркер
#                       ~/skilllink/alerts/<вид>.firing. Пока маркер есть, повторов
#                       нет, только напоминание раз в 6 часов и «стало хуже»,
#                       если warning сменился на critical;
#   ok                — «проверка снова в порядке». Маркер был — «восстановилось ✅»
#                       и маркер удаляется; не было — ничего не происходит;
#   info              — просто сообщение (сводка, итог учений), без маркера.
#
# Кому: активные администраторы с привязанным ботом (telegram_links, решение 102) —
# из базы через psql в контейнере — и TELEGRAM_OWNER_CHAT_ID из .env.cloud. База
# недоступна (а сообщают часто именно об этом) — последний известный список
# из ~/skilllink/alerts/.recipients.
#
# Токен — только из .env.cloud (TELEGRAM_BOT_TOKEN), в командную строку не попадает:
# адрес с ним уходит в curl через stdin (-K -), в `ps` его нет. Бот не настроен —
# строка «бот не настроен» в журнале и код 0: для сторожа это не ошибка.
# TELEGRAM_API_IP — как у приложения: из Yandex Cloud api.telegram.org по имени
# не отвечает, поэтому соединение идёт на IP, а имя в TLS остаётся прежним (--resolve).
#
# Отправлено — только если Telegram ответил "ok":true.
#
# Код выхода: 0 — отправлено, подавлено как повтор или бот не настроен; 1 — неверный
# вызов; 3 — Telegram не принял ни одному получателю (маркер не ставится — следующий
# запуск сторожа попробует снова).
#
# ALERT_DRY_RUN=1 — ничего не отправлять, печатать сообщение (проверка на своей машине).
set -uo pipefail
set +x
umask 077

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

REMIND_AFTER_S=${ALERT_REMIND_AFTER_S:-21600}

kind=${1:-}
severity=${2:-}
text=${3:-}

usage() {
  echo "Использование: scripts/ops/alert.sh <вид> <critical|warning|ok|info> <текст>" >&2
  exit 1
}
[[ $kind =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || usage
case $severity in critical | warning | ok | info) ;; *) usage ;; esac

mkdir -p "$ALERT_DIR"
LOG_FILE="$ALERT_DIR/alerts.log"
marker="$ALERT_DIR/$kind.firing"

log() { printf '%s %s %s %s\n' "$(date '+%F %T')" "$kind" "$severity" "$*" >> "$LOG_FILE"; }

# ── Кому ────────────────────────────────────────────────────────────────────
recipients() {
  local owner from_db cache="$ALERT_DIR/.recipients"
  owner=$(env_get TELEGRAM_OWNER_CHAT_ID 2> /dev/null || true)
  if from_db=$(psql_query \
    "SELECT t.chat_id FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE u.role = 'ADMIN' AND u.is_active" \
    2> /dev/null); then
    printf '%s\n' "$from_db" > "$cache"
  else
    from_db=$(cat "$cache" 2> /dev/null || true)
  fi
  printf '%s\n%s\n' "$owner" "$from_db" | grep -E '^-?[0-9]{1,20}$' | sort -u
}

# ── Отправка одному ─────────────────────────────────────────────────────────
send_one() {
  local chat=$1 message=$2 base host ip reply
  base=$(env_get TELEGRAM_API_BASE)
  base=${base:-https://api.telegram.org}
  base=${base%/}
  host=$(printf '%s' "$base" | sed -E 's#^https?://([^/:]+).*#\1#')
  ip=$(env_get TELEGRAM_API_IP)
  local resolve=()
  [[ $ip =~ ^[0-9a-fA-F.:]+$ ]] && resolve=(--resolve "$host:443:$ip")
  # Адрес с токеном — через stdin: в аргументах curl (и в `ps`) его нет.
  reply=$(printf 'url = "%s/bot%s/sendMessage"\n' "$base" "$TOKEN" |
    curl -s --max-time 15 -K - ${resolve[@]+"${resolve[@]}"} \
      --data-urlencode "chat_id=$chat" \
      --data-urlencode "text=$message" \
      --data-urlencode "disable_web_page_preview=true" 2> /dev/null) || {
    LAST_ERROR="curl код $?"
    return 1
  }
  if printf '%s' "$reply" | grep -q '"ok":[[:space:]]*true'; then return 0; fi
  # Описание ошибки Telegram — без токена и без текста сообщения.
  LAST_ERROR=$(printf '%s' "$reply" | sed -nE 's/.*"description":"([^"]{0,120}).*/\1/p')
  LAST_ERROR=${LAST_ERROR:-ответ без ok:true}
  return 1
}

# 0 — отправлено хотя бы одному; 2 — бот не настроен или получателей нет; 3 — не принято.
deliver() {
  local message=$1 chats chat sent=0 total=0
  if [ "${ALERT_DRY_RUN:-}" = "1" ]; then
    printf '── [ALERT_DRY_RUN] сообщение:\n%s\n' "$message"
    log "пробный запуск, не отправлено"
    return 0
  fi
  TOKEN=""
  [ -r "$ENV_FILE" ] && TOKEN=$(env_get TELEGRAM_BOT_TOKEN)
  if [ -z "$TOKEN" ]; then
    log "бот не настроен (нет TELEGRAM_BOT_TOKEN в $ENV_FILE) — не отправлено"
    echo "бот не настроен — оповещение не отправлено: $kind $severity" >&2
    return 2
  fi
  chats=$(recipients)
  if [ -z "$chats" ]; then
    log "получателей нет: ни администратора с привязанным ботом, ни TELEGRAM_OWNER_CHAT_ID"
    return 2
  fi
  LAST_ERROR=""
  for chat in $chats; do
    total=$((total + 1))
    send_one "$chat" "$message" && sent=$((sent + 1))
  done
  log "отправлено $sent из $total${LAST_ERROR:+ (последняя ошибка: $LAST_ERROR)}"
  [ "$sent" -gt 0 ] && return 0
  return 3
}

# ── Текст ───────────────────────────────────────────────────────────────────
stamp() { TZ=Europe/Moscow date '+%d.%m %H:%M МСК'; }
where=$(hostname -s 2> /dev/null || hostname)
case $severity in
  critical) mark='🔴' ;;
  warning) mark='🟠' ;;
  ok) mark='✅' ;;
  *) mark='🔵' ;;
esac
compose() { printf '%s SkillLink · %s · %s\n%s\n%s' "$mark" "$1" "$where" "$text" "$(stamp)"; }

# ── Что делать ──────────────────────────────────────────────────────────────
case $severity in
  info)
    deliver "$(compose "$kind")"
    code=$?
    [ "$code" = 3 ] && exit 3
    exit 0
    ;;
  ok)
    [ -f "$marker" ] || exit 0
    started=$(head -n 1 "$marker" 2> /dev/null | tr -cd '0-9')
    duration=""
    [ -n "$started" ] && duration=" (было $(human_duration $(( $(date +%s) - started ))))"
    deliver "$(compose "восстановилось: $kind$duration")"
    code=$?
    # Не доставлено из-за сети — маркер остаётся: следующий запуск сообщит снова.
    [ "$code" = 3 ] && exit 3
    rm -f "$marker"
    exit 0
    ;;
  critical | warning)
    # Стало хуже (warning → critical) — это новость, а не повтор.
    if [ -f "$marker" ] && [ "$severity" = critical ] && [ "$(sed -n 2p "$marker")" = warning ]; then
      deliver "$(compose "стало хуже: $kind")"
      code=$?
      [ "$code" = 3 ] && exit 3
      { head -n 1 "$marker"; printf '%s\n%s\n' "$severity" "$text"; } > "$marker.tmp" && mv "$marker.tmp" "$marker"
      exit 0
    fi
    if [ -f "$marker" ]; then
      age=$(age_seconds "$marker")
      if [ "$age" -lt "$REMIND_AFTER_S" ]; then
        log "повтор подавлен (последнее сообщение $(human_duration "$age") назад)"
        exit 0
      fi
      started=$(head -n 1 "$marker" | tr -cd '0-9')
      deliver "$(compose "всё ещё: $kind, уже $(human_duration $(( $(date +%s) - ${started:-$(date +%s)} )))")"
      code=$?
      [ "$code" = 3 ] && exit 3
      touch "$marker"
      exit 0
    fi
    deliver "$(compose "$kind")"
    code=$?
    [ "$code" = 3 ] && exit 3
    printf '%s\n%s\n%s\n' "$(date +%s)" "$severity" "$text" > "$marker"
    exit 0
    ;;
esac
