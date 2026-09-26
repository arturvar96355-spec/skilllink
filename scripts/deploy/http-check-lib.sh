# Проверка адресов после выкладки (решение 118). Подключается через source из
# remote-up.sh (на сервере) и check.sh (снаружи). Сам не запускается.
#
#   wait_http <адрес> <ожидаемые коды через |> <что проверяем> [секунд]
#   http_fails_report   — печатает все провалы и команду отката; код 1, если они были
#
# Адрес опрашивается раз в 2 секунды, пока не ответит ожидаемым кодом, но не дольше
# 60 секунд (WAIT_HTTP_SECONDS): приложение после `up -d` отвечает не сразу, а Caddy
# при первом запуске ещё получает сертификат. Провал не останавливает проверку —
# провалы копятся, и в конце виден весь список, а не первая ошибка.
#
# WAIT_HTTP_RESOLVE=имя:порт:ip — соединяться на ip, оставив имя (SNI, Host):
# так проверяется Caddy с настоящим сертификатом изнутри машины.
# WAIT_HTTP_INSECURE=1 — не проверять сертификат (локальный стенд).
# shellcheck shell=bash

HTTP_FAILS=()

wait_http() {
  local url=$1 expected=$2 label=$3 limit=${4:-${WAIT_HTTP_SECONDS:-60}}
  local code="" start=$SECONDS
  local extra=()
  [ -n "${WAIT_HTTP_RESOLVE:-}" ] && extra+=(--resolve "$WAIT_HTTP_RESOLVE")
  [ -n "${WAIT_HTTP_INSECURE:-}" ] && extra+=(-k)
  while :; do
    # `|| true`: под set -e недоступный адрес не должен обрывать весь скрипт.
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${extra[@]+"${extra[@]}"} "$url" 2> /dev/null || true)
    if [[ "|$expected|" == *"|$code|"* ]]; then
      printf '  \033[32m✓\033[0m %s — %s (%d с)\n' "$label" "$code" $((SECONDS - start))
      return 0
    fi
    [ $((SECONDS - start)) -ge "$limit" ] && break
    sleep 2
  done
  [ "$code" = "000" ] && code="нет ответа"
  printf '  \033[31m✗\033[0m %s — %s, ждали %s (%d с)\n' "$label" "${code:-нет ответа}" "$expected" "$limit"
  HTTP_FAILS+=("$label: ${code:-нет ответа} вместо $expected — $url")
  return 1
}

http_fails_report() {
  [ "${#HTTP_FAILS[@]}" -eq 0 ] && return 0
  printf '\n\033[31mПроверка после выкладки не прошла: %s\033[0m\n' "${#HTTP_FAILS[@]}" >&2
  local item
  for item in "${HTTP_FAILS[@]}"; do printf '  ✗ %s\n' "$item" >&2; done
  if [ -n "${ROLLBACK_HINT:-}" ]; then
    printf '\nОткат на прошлую версию:\n%s\n' "$ROLLBACK_HINT" >&2
  fi
  return 1
}
