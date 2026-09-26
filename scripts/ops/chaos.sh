#!/usr/bin/env bash
# ┌──────────────────────────────────────────────────────────────────────────┐
# │ ХАОС-СЦЕНАРИИ. ЛОМАЮТ РАБОТАЮЩИЙ СТЕНД НАМЕРЕННО.                        │
# │                                                                          │
# │ Запускать только на своей машине (копия стенда, docs/OPERATIONS_TESTS.md)│
# │ или на стенде вручную владельцем — и НЕ в период экспертизы              │
# │ (30.09–14.10.2026): эксперт в этот момент увидит неработающую систему.   │
# │ Без флага --i-know скрипт ничего не делает.                              │
# └──────────────────────────────────────────────────────────────────────────┘
#
#   bash scripts/ops/chaos.sh --i-know [a|b|c|d|all]
#
#   a  падение процесса приложения (kill -9) — через сколько стенд снова отвечает;
#   b  остановка базы — /api/ready 503 при /api/health 200, затем база возвращается
#      и /api/ready снова 200 без перезапуска приложения;
#   c  перезапуск Caddy — сколько стенд недоступен снаружи;
#   d  штатная остановка приложения (SIGTERM, stop_grace_period) — за сколько
#      выходит и с каким кодом, и сколько поднимается обратно.
#
# Почему «падение» — это kill процесса из пространства PID машины, а не
# `docker kill` и не `docker exec <app> kill -9 1`:
#   * `docker kill` Docker считает ручной остановкой — политика restart:
#     unless-stopped его не перезапускает (проверено), это не падение;
#   * `kill -9 1` изнутри контейнера ядро игнорирует: процесс 1 в своём
#     пространстве PID получает только сигналы, на которые поставил обработчик,
#     а SIGKILL поставить нельзя (проверено: контейнер работает дальше).
#   Настоящее падение (нехватка памяти, ошибка рантайма) — это смерть процесса
#   «снаружи». Её и делаем: одноразовый контейнер с --pid=host шлёт SIGKILL
#   процессу приложения по его PID на машине. sudo не нужен — хватает группы docker.
#
# Настройки (по умолчанию — стенд на сервере):
#   APP_CONTAINER, PG_CONTAINER, CADDY_CONTAINER — имена контейнеров;
#   CHAOS_APP_URL   — приложение напрямую (http://127.0.0.1:3000);
#   CHAOS_PROXY_URL — через Caddy (http://127.0.0.1:80; для домена —
#                     https://<домен> и RESOLVE=<домен>:443:127.0.0.1).
# Итоги — на экран и строками в CHAOS_LOG (~/skilllink/chaos.log).
set -uo pipefail
set +x

# shellcheck source=scripts/ops/ops-lib.sh
. "$(dirname "$0")/ops-lib.sh"

if [ "${1:-}" != "--i-know" ]; then
  sed -n '2,10p' "$0" >&2
  echo "Запуск: bash scripts/ops/chaos.sh --i-know [a|b|c|d|all]" >&2
  exit 1
fi
shift
WHAT=${1:-all}

# Период экспертизы: на боевых именах контейнеров — отказ даже с флагом.
today=$(date +%Y%m%d)
if [ "$APP_CONTAINER" = skilllink-app ] && [ "$today" -ge 20260929 ] && [ "$today" -le 20261014 ] &&
  [ "${CHAOS_DURING_REVIEW:-}" != "да, я владелец и понимаю последствия" ]; then
  echo "Отказ: идёт период экспертизы (30.09–14.10), а контейнеры — боевые ($APP_CONTAINER)." >&2
  echo "Прогоните сценарии на копии стенда (docs/OPERATIONS_TESTS.md)." >&2
  exit 1
fi

APP_URL=${CHAOS_APP_URL:-http://127.0.0.1:3000}
PROXY_URL=${CHAOS_PROXY_URL:-http://127.0.0.1:80}
CHAOS_LOG=${CHAOS_LOG:-$HOME/skilllink/chaos.log}
KILLER_IMAGE=${KILLER_IMAGE:-postgres:16-alpine}
mkdir -p "$(dirname "$CHAOS_LOG")"

HTTP_TIMEOUT=2
code_of() { http_code "$1"; }
secs() { awk -v m="$1" 'BEGIN { printf "%.2f", m / 1000 }'; }
record() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$CHAOS_LOG"
}

# Ждать, пока адрес ответит нужным кодом; печатает миллисекунды от t0. Опрос — 5 раз в секунду.
wait_code() {
  local url=$1 want=$2 t0=$3 limit_ms=${4:-120000} got
  while :; do
    got=$(code_of "$url")
    if [ "$got" = "$want" ]; then
      echo $(($(now_ms) - t0))
      return 0
    fi
    [ $(($(now_ms) - t0)) -ge "$limit_ms" ] && { echo "-1"; return 1; }
    sleep 0.2
  done
}

preflight() {
  local c
  for c in "$APP_CONTAINER" "$PG_CONTAINER" "$CADDY_CONTAINER"; do
    [ "$(docker inspect -f '{{.State.Status}}' "$c" 2> /dev/null)" = running ] ||
      { echo "Контейнер $c не запущен — сначала поднимите стенд" >&2; exit 1; }
  done
  [ "$(code_of "$APP_URL/api/ready")" = 200 ] || { echo "$APP_URL/api/ready не 200 — стенд уже нездоров" >&2; exit 1; }
  [ "$(code_of "$PROXY_URL/api/ready")" = 200 ] || { echo "$PROXY_URL/api/ready не 200 — Caddy не пропускает" >&2; exit 1; }
}

started_of() { docker inspect -f '{{.State.StartedAt}}' "$1"; }
restarts_of() { docker inspect -f '{{.RestartCount}}' "$1"; }

# ── a. Падение процесса приложения ──────────────────────────────────────────
scenario_a() {
  echo "── a. kill -9 процесса приложения ($APP_CONTAINER)"
  local pid before t0 health ready proxy after
  pid=$(docker inspect -f '{{.State.Pid}}' "$APP_CONTAINER")
  before=$(restarts_of "$APP_CONTAINER")
  t0=$(now_ms)
  docker run --rm --pid=host --entrypoint kill "$KILLER_IMAGE" -9 "$pid" ||
    { echo "не удалось убить процесс $pid" >&2; return 1; }
  # Сначала убеждаемся, что процесс действительно умер, иначе «время восстановления» — ноль.
  local down=0
  for _ in $(seq 1 50); do
    [ "$(code_of "$APP_URL/api/health")" != 200 ] && { down=1; break; }
    [ "$(restarts_of "$APP_CONTAINER")" != "$before" ] && { down=1; break; }
    sleep 0.1
  done
  health=$(wait_code "$APP_URL/api/health" 200 "$t0")
  ready=$(wait_code "$APP_URL/api/ready" 200 "$t0")
  proxy=$(wait_code "$PROXY_URL/api/ready" 200 "$t0")
  after=$(restarts_of "$APP_CONTAINER")
  record "chaos a: kill -9 приложения → /api/health 200 через $(secs "$health") с, /api/ready — $(secs "$ready") с, через Caddy — $(secs "$proxy") с; перезапусков Docker: $before → $after; падение замечено: $([ $down = 1 ] && echo да || echo нет)"
}

# ── b. Остановка базы ───────────────────────────────────────────────────────
scenario_b() {
  echo "── b. docker stop $PG_CONTAINER"
  local app_started t0 t_stop not_ready health_during t1 back app_after
  app_started=$(started_of "$APP_CONTAINER")
  t0=$(now_ms)
  docker stop "$PG_CONTAINER" > /dev/null
  t_stop=$(( $(now_ms) - t0 ))
  not_ready=$(wait_code "$APP_URL/api/ready" 503 "$t0" 30000)
  health_during=$(code_of "$APP_URL/api/health")
  local proxy_during login_during
  proxy_during=$(code_of "$PROXY_URL/api/ready")
  login_during=$(code_of "$PROXY_URL/login")
  sleep 5
  health_later=$(code_of "$APP_URL/api/health")
  t1=$(now_ms)
  docker start "$PG_CONTAINER" > /dev/null
  back=$(wait_code "$APP_URL/api/ready" 200 "$t1" 120000)
  app_after=$(started_of "$APP_CONTAINER")
  record "chaos b: база остановлена за $(secs "$t_stop") с; /api/ready 503 через $(secs "$not_ready") с после остановки; /api/health во время простоя: $health_during, через 5 с: $health_later; через Caddy: ready $proxy_during, /login $login_during; после docker start /api/ready 200 через $(secs "$back") с; приложение не перезапускалось: $([ "$app_started" = "$app_after" ] && echo да || echo НЕТ)"
}

# ── c. Перезапуск Caddy ─────────────────────────────────────────────────────
scenario_c() {
  echo "── c. docker restart $CADDY_CONTAINER"
  local t0 cmd back
  t0=$(now_ms)
  docker restart "$CADDY_CONTAINER" > /dev/null
  cmd=$(( $(now_ms) - t0 ))
  back=$(wait_code "$PROXY_URL/api/ready" 200 "$t0")
  record "chaos c: docker restart Caddy занял $(secs "$cmd") с; через Caddy /api/ready снова 200 через $(secs "$back") с от начала"
}

# ── d. Штатная остановка приложения ─────────────────────────────────────────
scenario_d() {
  echo "── d. docker stop $APP_CONTAINER (SIGTERM, ждать до stop_grace_period)"
  local grace t0 stopped exit_code t1 health ready
  grace=$(docker inspect -f '{{.Config.StopTimeout}}' "$APP_CONTAINER")
  t0=$(now_ms)
  docker stop "$APP_CONTAINER" > /dev/null
  stopped=$(( $(now_ms) - t0 ))
  exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$APP_CONTAINER")
  t1=$(now_ms)
  docker start "$APP_CONTAINER" > /dev/null
  health=$(wait_code "$APP_URL/api/health" 200 "$t1")
  ready=$(wait_code "$PROXY_URL/api/ready" 200 "$t1")
  record "chaos d: docker stop приложения — вышло за $(secs "$stopped") с (предел ${grace:-по умолчанию} с), код выхода $exit_code ($([ "$exit_code" = 0 ] && echo 'сам, по SIGTERM' || echo 'добит SIGKILL или упал')); после start /api/health 200 через $(secs "$health") с, через Caddy /api/ready — $(secs "$ready") с"
}

preflight
case $WHAT in
  a) scenario_a ;;
  b) scenario_b ;;
  c) scenario_c ;;
  d) scenario_d ;;
  all)
    scenario_a
    scenario_b
    scenario_c
    scenario_d
    ;;
  *)
    echo "Неизвестный сценарий: $WHAT (a|b|c|d|all)" >&2
    exit 1
    ;;
esac
