#!/usr/bin/env bash
# Пароли демо-пользователей и секрет клиента Keycloak (ТЗ, функц. 10; решение 188) —
# после первого запуска профиля `keycloak`:
#
#   scripts/deploy/keycloak-users.sh              # локально, читает .env
#   ENV_FILE=~/skilllink/.env.cloud scripts/deploy/keycloak-users.sh   # на стенде
#
# Зачем отдельный скрипт, а не пароли в файле импорта реалма
# (deploy/keycloak/skilllink-realm.json). Keycloak 26 НЕ подставляет переменные
# окружения внутри JSON импорта реалма — это подтверждено живой проверкой (задача
# решения 188): значение вида "${SEED_DEMO_PASSWORD}" в файле импорта попадает
# в базу Keycloak буквальной строкой, а не паролем. Поэтому пользователи заводятся
# импортом БЕЗ пароля (пустой credentials), а пароль и секрет клиента задаются
# этим скриптом уже в работающем контейнере через kcadm.sh — так ни один секрет
# не лежит в репозитории и не проходит через диск на сервере.
#
# Что делает:
#   1. Входит в Keycloak как временный администратор (KEYCLOAK_ADMIN_USER/PASSWORD).
#   2. Каждому демо-пользователю реалма skilllink задаёt тот же пароль, что
#      у демо-пользователей самой базы SkillLink (SEED_DEMO_PASSWORD, по умолчанию
#      "skilllink" — как в prisma/seed.ts).
#   3. Клиенту skilllink-web задаёт секрет KEYCLOAK_CLIENT_SECRET — тем же
#      значением, что читает приложение (.env / .env.cloud), иначе вход
#      через Keycloak будет отвечать invalid_client.
#
# Идемпотентен: повторный запуск просто переустанавливает те же значения.
set -euo pipefail

ENV_FILE=${ENV_FILE:-.env}
CONTAINER=${KEYCLOAK_CONTAINER:-skilllink-keycloak}
REALM=${KEYCLOAK_REALM:-skilllink}
CLIENT_ID=${KEYCLOAK_CLIENT_ID_NAME:-skilllink-web}
# Внутри контейнера — прямой адрес, минуя Caddy и опубликованный порт хоста.
KC_URL=http://localhost:8080/auth

cd "$(git rev-parse --show-toplevel)"

say() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
fail() {
  say "СБОЙ: $*" >&2
  exit 1
}

# Значение переменной из ENV_FILE; кавычки вокруг значения снимаются.
# Файл не исполняется через source: в нём могут быть строки, которые bash
# понял бы иначе (тот же приём, что offsite-lib.sh).
env_get() {
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" 2> /dev/null | tail -n 1) || true
  line=${line#*=}
  case "$line" in
    \"*\") line=${line#\"} && line=${line%\"} ;;
    \'*\') line=${line#\'} && line=${line%\'} ;;
  esac
  printf '%s' "$line"
}

[ -r "$ENV_FILE" ] || fail "нет файла настроек $ENV_FILE (укажите ENV_FILE=путь)"

ADMIN_USER=$(env_get KEYCLOAK_ADMIN_USER)
ADMIN_PASSWORD=$(env_get KEYCLOAK_ADMIN_PASSWORD)
CLIENT_SECRET=$(env_get KEYCLOAK_CLIENT_SECRET)
DEMO_PASSWORD=$(env_get SEED_DEMO_PASSWORD)

ADMIN_USER=${ADMIN_USER:-admin}
DEMO_PASSWORD=${DEMO_PASSWORD:-skilllink}

[ -n "$ADMIN_PASSWORD" ] || fail "KEYCLOAK_ADMIN_PASSWORD не задан в $ENV_FILE"
[ -n "$CLIENT_SECRET" ] || fail "KEYCLOAK_CLIENT_SECRET не задан в $ENV_FILE"

docker inspect "$CONTAINER" > /dev/null 2>&1 \
  || fail "контейнер $CONTAINER не запущен — сначала: docker compose --profile keycloak up -d"

kcadm() { docker exec "$CONTAINER" /opt/keycloak/bin/kcadm.sh "$@"; }

say "Вход администратором Keycloak…"
kcadm config credentials --server "$KC_URL" --realm master --user "$ADMIN_USER" --password "$ADMIN_PASSWORD" \
  || fail "не удалось войти в Keycloak администратором — проверьте KEYCLOAK_ADMIN_USER/PASSWORD"

# Демо-пользователи реалма skilllink — тот же список email, что в
# deploy/keycloak/skilllink-realm.json (и в prisma/seed.ts, кроме
# former.employee@ и expert-*@ — см. комментарий в файле импорта).
DEMO_EMAILS=(
  admin@skilllink.demo
  manager@skilllink.demo
  manager2@skilllink.demo
  analyst@skilllink.demo
  viewer@skilllink.demo
  admin2@skilllink.demo
  head@skilllink.demo
  rep@spbgu.example.invalid
)

say "Пароли демо-пользователей реалма $REALM…"
for email in "${DEMO_EMAILS[@]}"; do
  user_id=$(kcadm get users -r "$REALM" -q "email=$email" --fields id --format csv --noquotes 2> /dev/null | head -n1)
  if [ -z "$user_id" ]; then
    say "  ! $email не найден в реалме $REALM — пропускаю (импорт реалма не выполнен?)"
    continue
  fi
  kcadm set-password -r "$REALM" --userid "$user_id" --new-password "$DEMO_PASSWORD" --temporary=false \
    || fail "не удалось задать пароль для $email"
  say "  ok $email"
done

say "Секрет клиента $CLIENT_ID…"
client_uid=$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes 2> /dev/null | head -n1)
[ -n "$client_uid" ] || fail "клиент $CLIENT_ID не найден в реалме $REALM — импорт реалма выполнен?"
kcadm update "clients/$client_uid" -r "$REALM" -s "secret=$CLIENT_SECRET" \
  || fail "не удалось задать секрет клиента $CLIENT_ID"

say "Готово: пароли демо-пользователей и секрет клиента заданы из $ENV_FILE."
