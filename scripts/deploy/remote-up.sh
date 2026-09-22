#!/usr/bin/env bash
# Поднимает стенд на сервере. Запускается развёртыванием из каталога с кодом:
#   ENV_FILE=~/skilllink/.env.cloud SEED=1 bash scripts/deploy/remote-up.sh
#
# Порядок важен: сначала база, потом миграции, и только потом приложение.
# Приложение без применённых миграций не проходит проверку живости, а Caddy
# ждёт здорового приложения — и всё развёртывание останавливается на ровном месте.
set -euo pipefail

ENV_FILE=${ENV_FILE:?не задан ENV_FILE}
SEED=${SEED:-0}
COMPOSE="docker compose -p skilllink -f docker-compose.yml -f deploy/yandex-cloud/compose.cloud.yml --env-file $ENV_FILE"

echo "── Поднимаю базу"
$COMPOSE up -d postgres

printf '   жду готовности базы'
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' skilllink-postgres 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  printf '.'
  sleep 2
done
echo " $(docker inspect -f '{{.State.Health.Status}}' skilllink-postgres 2>/dev/null || echo '?')"

run_migrations() {
  $COMPOSE --profile migrate run --rm migrate 2>&1 | tee /tmp/skilllink-migrate.log
  return "${PIPESTATUS[0]}"
}

echo "── Применяю миграции"
if ! run_migrations; then
  if grep -q "P1000\|Authentication failed" /tmp/skilllink-migrate.log; then
    # Пароль в настройках разошёлся с тем, с которым создан том базы:
    # POSTGRES_PASSWORD действует только при создании. Такое бывает, когда
    # стенд переразворачивают, а .env.cloud создан заново.
    echo "   база отвергла пароль — привожу её к паролю из $ENV_FILE"
    PASSWORD=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
    USER_NAME=$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- || true)
    docker exec -i skilllink-postgres psql -U "${USER_NAME:-skilllink}" -d postgres \
      -c "ALTER USER \"${USER_NAME:-skilllink}\" PASSWORD '$PASSWORD'" > /dev/null
    echo "   повторяю миграции"
    run_migrations
  else
    echo "   миграции не применились — смотрите вывод выше" >&2
    exit 1
  fi
fi

if [ "$SEED" = "1" ]; then
  echo "── Загружаю демонстрационные данные"
  $COMPOSE --profile migrate run --rm migrate npm run db:seed
fi

echo "── Поднимаю приложение и Caddy"
$COMPOSE --profile app up -d --build

printf '   жду готовности приложения'
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' skilllink-app 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  printf '.'
  sleep 2
done
state=$(docker inspect -f '{{.State.Health.Status}}' skilllink-app 2>/dev/null || echo '?')
echo " $state"

if [ "$state" != healthy ]; then
  echo "   приложение не здорово. Что оно само говорит о причине:" >&2
  docker exec skilllink-app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log(t))" 2>&1 | tail -2 >&2
  docker compose -p skilllink logs --tail 20 app >&2 || true
  exit 1
fi

echo "── Стенд поднят"
