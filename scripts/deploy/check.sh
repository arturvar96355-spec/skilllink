#!/usr/bin/env bash
# Проверка развёрнутого стенда — снаружи, как его увидит пользователь.
#
#   scripts/deploy/check.sh <адрес> [хост-для-проверки-портов]
#   DEMO_PASSWORD=... scripts/deploy/check.sh https://skilllink.example.ru
#
# Отвечает на вопросы, которые не видны из «сайт открывается»:
# закрыты ли база и приложение напрямую, не отправит ли вход на localhost,
# выключен ли вход без пароля, дошли ли миграции.
set -uo pipefail

URL=${1:-}
HOST=${2:-$(echo "$URL" | sed -E 's#^https?://##; s#[:/].*##')}
PASSWORD=${DEMO_PASSWORD:-}

# INSECURE=1 — не проверять сертификат. Нужно только для локального стенда,
# где Caddy выпускает его сам. На настоящем стенде так запускать нечего:
# доверие к сертификату — часть проверки.
CURL_INSECURE=${INSECURE:+-k}

[ -z "$URL" ] && { echo "Использование: scripts/deploy/check.sh <адрес>" >&2; exit 1; }

passed=0
failed=0
check() {
  if [ "$2" = "1" ]; then
    printf '  \033[32mOK\033[0m   %s %s\n' "$1" "${3:-}"; passed=$((passed + 1))
  else
    printf '  \033[31mFAIL\033[0m %s %s\n' "$1" "${3:-}"; failed=$((failed + 1))
  fi
}
yes_no() { [ "$1" = "$2" ] && echo 1 || echo 0; }

echo "Проверка стенда: $URL"

# ── Живость и база ──────────────────────────────────────────────────────────
HEALTH=$(curl -fsS $CURL_INSECURE --max-time 20 "$URL/api/health" 2>/dev/null || echo '{}')
STATUS=$(echo "$HEALTH" | sed -nE 's/.*"status":"([a-z]+)".*/\1/p')
SCHEMA=$(echo "$HEALTH" | sed -nE 's/.*"schema":"([a-z]+)".*/\1/p')
check "приложение отвечает и видит базу" "$(yes_no "$STATUS" ok)" "status=${STATUS:-нет ответа}"
check "миграции применены" "$(yes_no "$SCHEMA" ready)" "schema=${SCHEMA:-?}"

# ── Вход без пароля выключен ────────────────────────────────────────────────
ME=$(curl -s $CURL_INSECURE -o /dev/null -w '%{http_code}' --max-time 20 "$URL/api/me")
check "вход без пароля выключен" "$(yes_no "$ME" 401)" "/api/me без сессии → $ME (нужен 401)"

# ── Защитные заголовки ──────────────────────────────────────────────────────
HEADERS=$(curl -fsSI $CURL_INSECURE --max-time 20 "$URL/api/health" 2>/dev/null | tr 'A-Z' 'a-z')
for header in x-content-type-options x-frame-options referrer-policy; do
  check "заголовок $header" "$(echo "$HEADERS" | grep -qi "^$header:" && echo 1 || echo 0)"
done

# ── HTTPS ───────────────────────────────────────────────────────────────────
case "$URL" in
  https://*)
    REDIRECT=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://$HOST" || echo 000)
    check "http перенаправляется на https" "$([ "$REDIRECT" = "301" ] || [ "$REDIRECT" = "308" ] && echo 1 || echo 0)" "код $REDIRECT"
    if [ -n "$CURL_INSECURE" ]; then
      printf '  \033[33m··\033[0m   Сертификат не проверяется: запущено с INSECURE=1\n'
    else
      check "сертификат принимается без -k" "$(curl -fsS --max-time 20 -o /dev/null "$URL/api/health" && echo 1 || echo 0)"
    fi
    ;;
  *)
    printf '  \033[33m··\033[0m   HTTPS нет: стенд открыт по http, пароли идут открытым текстом\n'
    ;;
esac

# ── Страницы не показываются из кэша без проверки ───────────────────────────
#
# Иначе после выкладки пользователь видит вчерашний стенд и уверен, что ничего
# не изменилось. Так и было: браузер неделю показывал старую заглушку.
CACHE_HEADER=$(curl -s $CURL_INSECURE -I --max-time 20 "$URL/login" | sed -nE 's/^[Cc]ache-[Cc]ontrol: *//p' | tr -d '\r')
case "$CACHE_HEADER" in
  *no-cache*|*no-store*|*"max-age=0"*)
    check "страницы не кэшируются без проверки" 1 "$CACHE_HEADER"
    ;;
  *)
    check "страницы не кэшируются без проверки" 0 "Cache-Control: ${CACHE_HEADER:-(нет)} — браузер покажет старую версию"
    ;;
esac

# ── Устаревшая сессия не запирает вход ──────────────────────────────────────
#
# После перезаливки демо-данных cookie в браузере указывает на пользователя,
# которого больше нет. Приложение ведёт такого на вход с reauth=1, и middleware
# обязан эту страницу открыть: раньше вход возвращал на главную, главная —
# на вход, и экран оставался пустым (решение 48).
STALE=$(curl -s $CURL_INSECURE -o /dev/null -w '%{http_code}' --max-time 20 \
  -H 'Cookie: __Secure-authjs.session-token=stale; authjs.session-token=stale' "$URL/login?reauth=1")
check "вход открывается при устаревшей сессии" "$(yes_no "$STALE" 200)" "/login?reauth=1 со старым cookie → $STALE"

# ── Порты базы и приложения закрыты снаружи ─────────────────────────────────
#
# Сначала стучимся в заведомо пустой порт. Если и он «отвечает», значит между
# нами и сервером стоит посредник, который принимает любое соединение, —
# так ведут себя корпоративные сети, некоторые VPN и мобильные операторы.
# В такой сети проверка портов ничего не значит: она покажет открытым всё
# подряд, и настоящую дыру в этом шуме никто не заметит.
if command -v nc > /dev/null; then
  if nc -z -G 5 -w 5 "$HOST" 9 2>/dev/null; then
    printf '  \033[33m··\033[0m   Порты не проверены: сеть отвечает на любой порт (проверено портом 9).\n'
    printf '       Запустите проверку из другой сети или посмотрите правила группы безопасности.\n'
  else
    for port in 5432 3000; do
      nc -z -G 5 -w 5 "$HOST" "$port" 2>/dev/null && open=1 || open=0
      check "порт $port закрыт снаружи" "$(yes_no "$open" 0)" "$([ "$open" = 1 ] && echo 'ОТКРЫТ — закройте группой безопасности')"
    done
  fi
fi

# ── Вход: куда отправляет после него ────────────────────────────────────────
if [ -n "$PASSWORD" ]; then
  JAR=$(mktemp)
  CSRF=$(curl -s $CURL_INSECURE -c "$JAR" --max-time 20 "$URL/api/auth/csrf" | sed -nE 's/.*"csrfToken":"([^"]+)".*/\1/p')
  check "страница входа отдаёт csrf-токен" "$([ -n "$CSRF" ] && echo 1 || echo 0)"
  LOCATION=$(curl -s $CURL_INSECURE -o /dev/null -b "$JAR" -c "$JAR" -w '%{redirect_url}' --max-time 20 \
    -X POST "$URL/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$CSRF" \
    --data-urlencode "email=admin@skilllink.demo" \
    --data-urlencode "password=$PASSWORD")
  rm -f "$JAR"
  case "$LOCATION" in
    "$URL"*) check "после входа остаёмся на своём адресе" 1 "$LOCATION" ;;
    *localhost*) check "после входа остаёмся на своём адресе" 0 "отправляет на $LOCATION — не задан AUTH_URL" ;;
    *) check "после входа остаёмся на своём адресе" 0 "отправляет на ${LOCATION:-(пусто)}" ;;
  esac
else
  printf '  \033[33m··\033[0m   Вход не проверен: задайте DEMO_PASSWORD=...\n'
fi

echo
if [ "$failed" -gt 0 ]; then
  printf '  \033[31mПроблем: %s\033[0m (пройдено %s)\n' "$failed" "$passed"
  exit 1
fi
printf '  \033[32mВсе проверки пройдены: %s\033[0m\n' "$passed"
