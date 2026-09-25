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

# ── Соединение с сервером ───────────────────────────────────────────────────
#
# Сборка образа идёт несколько минут и почти всё это время молчит. Для сети
# между нами и сервером молчащее соединение выглядит заброшенным: корпоративные
# сети, VPN и мобильные операторы обрывают такие сами. Дважды подряд выкладка
# оборвалась именно так — на `npm ci`.
#
# ServerAliveInterval заставляет клиента посылать сигнал каждые 15 секунд,
# и соединение перестаёт выглядеть мёртвым. Восемь пропущенных подряд — тогда
# уже настоящий обрыв.
SSH_OPTS="-o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectTimeout=20"
# shellcheck disable=SC2086 # параметры должны разделиться на отдельные аргументы
ssh_run() { ssh $SSH_OPTS "$@"; }

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
ssh_run "$TARGET" 'bash -s' < scripts/deploy/server-setup.sh

# ── 2. Секреты: создаются один раз и остаются на сервере ────────────────────
# shellcheck disable=SC2087
ssh_run "$TARGET" "bash -s" <<REMOTE
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
git archive --format=tar HEAD | ssh_run "$TARGET" "
  set -euo pipefail
  rm -rf $REMOTE_DIR/app.new && mkdir -p $REMOTE_DIR/app.new
  tar -x -C $REMOTE_DIR/app.new
  rm -rf $REMOTE_DIR/app.old
  [ -d $REMOTE_DIR/app ] && mv $REMOTE_DIR/app $REMOTE_DIR/app.old
  mv $REMOTE_DIR/app.new $REMOTE_DIR/app
"

# ── 4. Сборка и запуск ──────────────────────────────────────────────────────
# `sg docker` — чтобы первое развёртывание не требовало перезайти по SSH
# после добавления пользователя в группу docker.
#
# Порядок (база → миграции → приложение) и разбор ошибок — в remote-up.sh:
# он уехал на сервер вместе с кодом.
echo "── Поднимаю стенд (первый раз — несколько минут)"
ssh_run "$TARGET" "cd $REMOTE_DIR/app && sg docker -c 'ENV_FILE=$REMOTE_DIR/.env.cloud SEED=${SEED:-0} bash scripts/deploy/remote-up.sh'"

# Отметка «развёрнут такой-то коммит» — только после того, как стенд поднялся.
# Раньше она писалась вместе с кодом, до сборки. 23.09.2026 сервер оборвал
# соединение посреди сборки: отметка уже говорила «df2ac15», а работало
# приложение прошлой версии. Задача, которая обновляет стенд по этой отметке,
# сочла бы его свежим и больше не пыталась.
ssh_run "$TARGET" "echo $COMMIT > $REMOTE_DIR/app/DEPLOYED_COMMIT"

# ── 5. Проверка снаружи ─────────────────────────────────────────────────────
# С доменом Caddy получает сертификат уже после старта — первый раз это
# несколько секунд. Проверка, запущенная сразу, видела бы девять провалов
# подряд при исправном стенде: так и случилось при первом развёртывании.
if [ -n "$DOMAIN" ]; then
  printf '── Жду сертификат'
  for _ in $(seq 1 30); do
    curl -fsS --max-time 5 -o /dev/null "$PUBLIC_URL/api/health" 2>/dev/null && break
    printf '.'
    sleep 4
  done
  echo
fi

echo "── Проверяю стенд снаружи"
PASSWORD=$(ssh_run "$TARGET" "grep '^SEED_DEMO_PASSWORD=' $REMOTE_DIR/.env.cloud | cut -d= -f2")
# В GitHub Actions журнал выкладки видят все, у кого есть доступ к репозиторию.
# Маска прячет пароль, если он всё же попадёт в вывод какой-нибудь команды.
if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "$PASSWORD" ]; then
  echo "::add-mask::$PASSWORD"
fi
DEMO_PASSWORD="$PASSWORD" scripts/deploy/check.sh "$PUBLIC_URL" "$HOST"

echo
echo "━━ Готово: $PUBLIC_URL"
# Пароль печатается только при запуске с машины владельца: на неё опираются его
# скрипты, формат строки не менять. В CI журнал общий — там только где его взять.
if [ -z "${CI:-}" ]; then
  echo "   Пароль демо-пользователей: $PASSWORD"
else
  echo "   Пароль демо-пользователей: в .env.cloud на сервере"
fi
echo "   Вход: $PUBLIC_URL/login (admin@skilllink.demo и другие — README.md)"
echo "   Журнал: ssh $TARGET \"cd $REMOTE_DIR/app && docker compose -p skilllink logs -f app\""
