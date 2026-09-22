#!/usr/bin/env bash
# Развёртывание SkillLink на сервере (Yandex Cloud или любая Ubuntu с доступом по SSH).
#
#   scripts/deploy/deploy.sh <логин@адрес> [домен]
#
#   scripts/deploy/deploy.sh skilllink@51.250.1.2 skilllink.example.ru   # с HTTPS
#   scripts/deploy/deploy.sh skilllink@51.250.1.2                        # http по IP
#
# Что делает: готовит сервер, кладёт туда код, поднимает базу, приложение и Caddy,
# применяет миграции и проверяет результат снаружи.
#
# Код уходит через `git archive`: на сервер попадает только то, что лежит в git.
# Ни .env, ни личные файлы, ни доступ к GitHub с сервера не нужны.
set -euo pipefail

TARGET=${1:-}
DOMAIN=${2:-}
REMOTE_DIR=${REMOTE_DIR:-'~/skilllink'}

if [ -z "$TARGET" ]; then
  echo "Использование: scripts/deploy/deploy.sh <логин@адрес> [домен]" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

# ── Что именно разворачиваем ────────────────────────────────────────────────
COMMIT=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then
  echo "ВНИМАНИЕ: есть незакоммиченные изменения — на сервер уйдёт коммит $COMMIT без них."
  printf "Продолжить? [y/N] "
  read -r answer
  [ "$answer" = "y" ] || exit 1
fi

HOST=${TARGET#*@}
if [ -n "$DOMAIN" ]; then
  SITE_ADDRESS=$DOMAIN
  PUBLIC_URL="https://$DOMAIN"
else
  SITE_ADDRESS=":80"
  PUBLIC_URL="http://$HOST"
fi

echo "━━ Разворачиваю $COMMIT на $TARGET → $PUBLIC_URL"

# ── 1. Сервер ───────────────────────────────────────────────────────────────
ssh "$TARGET" 'bash -s' < scripts/deploy/server-setup.sh

# ── 2. Секреты: создаются один раз и остаются на сервере ────────────────────
# shellcheck disable=SC2087
ssh "$TARGET" "bash -s" <<REMOTE
set -euo pipefail
mkdir -p $REMOTE_DIR
ENV_FILE=$REMOTE_DIR/.env.cloud
if [ ! -f "\$ENV_FILE" ]; then
  echo "── Создаю секреты стенда (\$ENV_FILE)"
  umask 077
  {
    echo "# Секреты стенда. Создан развёртыванием, в git не попадает."
    # Пароль базы — только шестнадцатеричный: он подставляется в строку
    # подключения, и символы вроде @ или / её сломали бы.
    echo "POSTGRES_PASSWORD=\$(openssl rand -hex 24)"
    echo "DOCKER_AUTH_SECRET=\$(openssl rand -base64 32)"
    echo "SEED_DEMO_PASSWORD=\$(openssl rand -hex 8)"
    echo "DOCKER_DEMO_AUTH_ENABLED=false"
  } > "\$ENV_FILE"
fi
# Адрес может меняться между развёртываниями — переписываем каждый раз.
grep -v -E '^(SITE_ADDRESS|DOCKER_AUTH_URL)=' "\$ENV_FILE" > "\$ENV_FILE.tmp" || true
{
  echo "SITE_ADDRESS=$SITE_ADDRESS"
  echo "DOCKER_AUTH_URL=$PUBLIC_URL"
} >> "\$ENV_FILE.tmp"
mv "\$ENV_FILE.tmp" "\$ENV_FILE"
chmod 600 "\$ENV_FILE"
REMOTE

# ── 3. Код ──────────────────────────────────────────────────────────────────
echo "── Отправляю код ($COMMIT)"
git archive --format=tar HEAD | ssh "$TARGET" "
  set -euo pipefail
  rm -rf $REMOTE_DIR/app.new && mkdir -p $REMOTE_DIR/app.new
  tar -x -C $REMOTE_DIR/app.new
  rm -rf $REMOTE_DIR/app.old
  [ -d $REMOTE_DIR/app ] && mv $REMOTE_DIR/app $REMOTE_DIR/app.old
  mv $REMOTE_DIR/app.new $REMOTE_DIR/app
  echo $COMMIT > $REMOTE_DIR/app/DEPLOYED_COMMIT
"

# ── 4. Сборка и запуск ──────────────────────────────────────────────────────
# `sg docker` — чтобы первое развёртывание не требовало перезайти по SSH
# после добавления пользователя в группу docker.
COMPOSE="docker compose -p skilllink -f docker-compose.yml -f deploy/yandex-cloud/compose.cloud.yml --env-file $REMOTE_DIR/.env.cloud"

echo "── Собираю образ и поднимаю стенд (первый раз — несколько минут)"
ssh "$TARGET" "cd $REMOTE_DIR/app && sg docker -c '$COMPOSE --profile app up -d --build'"

echo "── Применяю миграции"
ssh "$TARGET" "cd $REMOTE_DIR/app && sg docker -c '$COMPOSE --profile migrate run --rm migrate'"

if [ "${SEED:-}" = "1" ]; then
  echo "── Загружаю демонстрационные данные (SEED=1)"
  ssh "$TARGET" "cd $REMOTE_DIR/app && sg docker -c '$COMPOSE --profile migrate run --rm migrate npm run db:seed'"
fi

# ── 5. Проверка снаружи ─────────────────────────────────────────────────────
echo "── Проверяю стенд снаружи"
PASSWORD=$(ssh "$TARGET" "grep '^SEED_DEMO_PASSWORD=' $REMOTE_DIR/.env.cloud | cut -d= -f2")
DEMO_PASSWORD="$PASSWORD" scripts/deploy/check.sh "$PUBLIC_URL" "$HOST"

echo
echo "━━ Готово: $PUBLIC_URL"
echo "   Пароль демо-пользователей: $PASSWORD"
echo "   Вход: $PUBLIC_URL/api/auth/signin (admin@skilllink.demo и другие — docs/HANDOFF.md)"
echo "   Журнал: ssh $TARGET \"cd $REMOTE_DIR/app && docker compose -p skilllink logs -f app\""
