#!/usr/bin/env bash
# Перезаливка демонстрационных данных на стенде — без пересборки приложения.
#
#   scripts/deploy/reseed.sh <логин@адрес> [домен]
#   scripts/deploy/reseed.sh skilllink@51.250.27.144 skilllink.site
#
# Когда нужна:
#   * перед показом. Даты демо-набора считаются от момента заливки, а время
#     идёт: через двое суток у первого этапа выходит срок, и на главной вместо
#     двенадцати проблемных этапов становится тринадцать (docs/DEMO.md);
#   * после генерального прогона — вернуть всё, что на нём нажимали.
#
# Стирает ВСЁ, что вносили на стенде руками: связки, этапы, документы,
# пользователей. Пароль демо-пользователей прежний — он в .env.cloud.
# Открытые вкладки попросят войти заново: пользователи создаются
# с новыми идентификаторами, и старая сессия ни на кого не указывает.
#
# DRY_RUN=1 — всё, кроме самой заливки: соединение, сборка образа, сверка
# со сценарием. Так проверяется сама команда, не трогая данные.
set -euo pipefail

TARGET=${1:-}
DOMAIN=${2:-}
REMOTE_DIR=${REMOTE_DIR:-'~/skilllink'}

if [ -z "$TARGET" ]; then
  echo "Использование: scripts/deploy/reseed.sh <логин@адрес> [домен]" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

# Те же параметры соединения, что у deploy.sh: сборка образа может молчать.
SSH_OPTS="-o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectTimeout=20"
# shellcheck disable=SC2086 # параметры должны разделиться на отдельные аргументы
ssh_run() { ssh $SSH_OPTS "$@"; }

HOST=${TARGET#*@}
if [ -n "$DOMAIN" ]; then PUBLIC_URL="https://$DOMAIN"; else PUBLIC_URL="http://$HOST"; fi

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "━━ Пробный прогон: данные на $PUBLIC_URL не меняются"
else
  echo "Демо-данные на $PUBLIC_URL будут стёрты и залиты заново."
  echo "Всё, что вносили на стенде руками, пропадёт. Вкладки попросят войти снова."
  printf "Продолжить? [y/N] "
  read -r answer
  [ "$answer" = "y" ] || exit 1
fi

# shellcheck disable=SC2087 # REMOTE_DIR и DRY_RUN подставляются здесь, остальное — на сервере
ssh_run "$TARGET" "bash -s" <<REMOTE
set -euo pipefail
cd $REMOTE_DIR/app
# Тильда раскрывается в присваивании, но не внутри кавычек — поэтому через переменную.
ENV_FILE=$REMOTE_DIR/.env.cloud
COMPOSE="docker compose -p skilllink -f docker-compose.yml -f deploy/yandex-cloud/compose.cloud.yml --env-file \$ENV_FILE"

echo "── Код на стенде: \$(cat DEPLOYED_COMMIT 2>/dev/null || echo неизвестен)"

# Образ пересобирается, чтобы seed.ts был из того же коммита, что и приложение.
# Если кэш сборки на месте — секунды; после чистки диска — до семи минут
# (23.09.2026 вышло 6,5). Поэтому перезаливать заранее, а не за пять минут до показа.
echo "── Собираю образ для заливки (до семи минут)"
\$COMPOSE --profile migrate build migrate > /tmp/skilllink-reseed-build.log 2>&1 || {
  tail -30 /tmp/skilllink-reseed-build.log >&2
  exit 1
}

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "── Заливку пропускаю: пробный прогон"
else
  echo "── Заливаю демонстрационные данные"
  \$COMPOSE --profile migrate run --rm migrate npm run db:seed
fi
REMOTE

echo "── Сверяю стенд со сценарием показа"
PASSWORD=$(ssh_run "$TARGET" "grep '^SEED_DEMO_PASSWORD=' $REMOTE_DIR/.env.cloud | cut -d= -f2")
SEED_DEMO_PASSWORD="$PASSWORD" npx tsx scripts/demo-check.ts "$PUBLIC_URL"
