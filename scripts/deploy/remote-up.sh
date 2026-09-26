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
# Короткий хеш коммита выкладки (риск 13 ревизии от 26.09.2026): deploy.sh считает его
# на машине владельца — .git на сервере нет (git archive не берёт историю) — и передаёт
# сюда переменной окружения. Пусто — контейнер поднят не через deploy.sh (например,
# вручную на сервере); `GET /api/health` тогда отдаёт commit: null.
APP_COMMIT=${APP_COMMIT:-}
# Имя проекта, дополнительный файл compose и имена контейнеров меняются только для
# локальной копии стенда (scripts/ops/compose.local.yml, docs/OPERATIONS_TESTS.md).
COMPOSE_PROJECT=${COMPOSE_PROJECT:-skilllink}
PG_CONTAINER=${PG_CONTAINER:-skilllink-postgres}
APP_CONTAINER=${APP_CONTAINER:-skilllink-app}
COMPOSE="docker compose -p $COMPOSE_PROJECT -f docker-compose.yml -f deploy/yandex-cloud/compose.cloud.yml ${EXTRA_COMPOSE_FILE:+-f $EXTRA_COMPOSE_FILE} --env-file $ENV_FILE"

# shellcheck source=scripts/deploy/http-check-lib.sh
. "$(dirname "$0")/http-check-lib.sh"
# Значение из файла настроек (без исполнения файла).
setting() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true; }

echo "── Поднимаю базу"
$COMPOSE up -d postgres

printf '   жду готовности базы'
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  printf '.'
  sleep 2
done
echo " $(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo '?')"

# Образ для миграций и демо-данных собирается заново при каждом развёртывании.
# `compose run` сам его не пересобирает — берёт тот, что уже есть: старый образ
# «применил» бы новую миграцию без неё самой, а SEED=1 залил бы старый seed.ts.
# Ступень builder у них общая, поэтому сборка приложения ниже берёт её из кэша
# и дольше не становится.
echo "── Собираю образ для миграций"
$COMPOSE --profile migrate build migrate

# ── Ворота: миграции в порядке до того, как их трогать (решение 137) ────────
#
# «failed» — прошлое развёртывание оборвалось посреди applying, и Prisma не
# станет накатывать следующую поверх, пока не разберёшься руками (`migrate
# resolve`). Изменённая (checksum) применённая миграция — файл в prisma/migrations
# правили уже после того, как его применили: значит, база и папка миграций
# разошлись, и «применить» не значит «применить то, что в git».
check_migration_status() {
  echo "── Проверяю состояние миграций"
  local status
  status=$($COMPOSE --profile migrate run --rm -T migrate npx prisma migrate status 2>&1) || true
  echo "$status"
  if echo "$status" | grep -qiE "failed to apply|modified after it was applied"; then
    echo "   миграции в плохом состоянии — останавливаюсь, база не тронута." >&2
    echo "   Разобраться на сервере: cd $PWD && $COMPOSE --profile migrate run --rm migrate npx prisma migrate status" >&2
    exit 1
  fi
}
check_migration_status

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
    docker exec -i "$PG_CONTAINER" psql -U "${USER_NAME:-skilllink}" -d postgres \
      -c "ALTER USER \"${USER_NAME:-skilllink}\" PASSWORD '$PASSWORD'" > /dev/null
    echo "   повторяю миграции"
    run_migrations
  else
    echo "   миграции не применились — смотрите вывод выше" >&2
    exit 1
  fi
fi

# ── Ворота: последняя папка миграций действительно применена (решение 137) ──
#
# `migrate deploy` выходит кодом 0, даже если применять было нечего, — само по
# себе это не значит, что применилась именно ПОСЛЕДНЯЯ миграция из этого коммита:
# так было бы, если бы код на сервере и папка migrations разошлись (не тот код
# ушёл `git archive`, слияние потеряло файл миграции). Без этой проверки стенд
# поднимется на старой схеме молча.
check_last_migration_applied() {
  local last
  last=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -1)
  [ -n "$last" ] || { echo "   в prisma/migrations нет ни одной папки — нечего проверять" >&2; return 0; }

  local user_name db_name applied
  user_name=$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- || true)
  db_name=$(grep '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- || true)
  applied=$(docker exec -i skilllink-postgres psql -U "${user_name:-skilllink}" -d "${db_name:-skilllink}" -tAc \
    "SELECT 1 FROM _prisma_migrations WHERE migration_name = '$last' AND finished_at IS NOT NULL LIMIT 1" | tr -d '[:space:]')
  if [ "$applied" != "1" ]; then
    echo "ОШИБКА: последняя миграция ($last) не отмечена применённой в _prisma_migrations." >&2
    echo "  Код и папка миграций на сервере разошлись — проверьте, что ушло git archive." >&2
    exit 1
  fi
  echo "── Последняя миграция применена: $last"
}
check_last_migration_applied

if [ "$SEED" = "1" ]; then
  echo "── Загружаю демонстрационные данные"
  $COMPOSE --profile migrate run --rm migrate npm run db:seed
fi

echo "── Поднимаю приложение и Caddy"
$COMPOSE --profile app up -d --build

printf '   жду готовности приложения'
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && break
  printf '.'
  sleep 2
done
state=$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || echo '?')
echo " $state"

if [ "$state" != healthy ]; then
  echo "   приложение не здорово. Что оно само говорит о причине:" >&2
  docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log(t))" 2>&1 | tail -2 >&2
  docker exec "$APP_CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>r.text()).then(t=>console.log(t))" 2>&1 | tail -2 >&2
  docker compose -p "$COMPOSE_PROJECT" logs --tail 20 app >&2 || true
  exit 1
fi

echo "── Стенд поднят"

# ── Проверка после выкладки (решение 118) ───────────────────────────────────
#
# «Контейнер здоров» значит только, что процесс жив (/api/health не ходит в базу).
# Готов ли стенд к пользователям — видно по ответам: приложение напрямую и через
# Caddy так, как их увидит браузер. Защищённый API без cookie обязан ответить
# ровно 401: так отвечает только само приложение, а значит, прокси до него доходит
# (502 — Caddy не видит приложение, 200 — открыт вход без пароля).
echo "── Проверяю стенд после выкладки"
APP_PORT=$(setting APP_PORT)
APP_URL="http://127.0.0.1:${APP_PORT:-3000}"
wait_http "$APP_URL/api/health" 200 "приложение живо (/api/health)" || true
wait_http "$APP_URL/api/ready" 200 "приложение готово: база и миграции (/api/ready)" || true

SITE_ADDRESS=$(setting SITE_ADDRESS)
case "$SITE_ADDRESS" in
  :*)
    HTTP_PORT=$(setting HTTP_PORT)
    PROXY_URL="http://127.0.0.1:${HTTP_PORT:-80}"
    ;;
  *)
    # Домен: соединяемся с Caddy на этой же машине, но с настоящим именем —
    # проверяется и сертификат. Снаружи то же самое проверит check.sh.
    HTTPS_PORT=$(setting HTTPS_PORT)
    PROXY_URL="https://$SITE_ADDRESS:${HTTPS_PORT:-443}"
    export WAIT_HTTP_RESOLVE="$SITE_ADDRESS:${HTTPS_PORT:-443}:127.0.0.1"
    ;;
esac
wait_http "$PROXY_URL/api/ready" 200 "через Caddy: /api/ready" || true
wait_http "$PROXY_URL/" 307 "через Caddy: главная без входа → /login (307)" || true
wait_http "$PROXY_URL/login" 200 "через Caddy: страница входа" || true
wait_http "$PROXY_URL/api/universities" 401 "через Caddy: API без cookie → 401" || true
unset WAIT_HTTP_RESOLVE

HERE=$(pwd)
PARENT=$(dirname "$HERE")
if [ -d "$PARENT/app.old" ] && [ "$(basename "$HERE")" = app ]; then
  ROLLBACK_HINT="  cd $PARENT && rm -rf app.failed && mv app app.failed && mv app.old app && \\
    cd app && ENV_FILE=$ENV_FILE bash scripts/deploy/remote-up.sh
  Миграции откат не отменяет: если новая версия их принесла, /api/ready старой версии
  ответит 200 со schema: ahead — это ожидаемо, данные целы (docs/DEPLOY.md, «Откат»)."
fi
if ! http_fails_report; then
  docker compose -p "$COMPOSE_PROJECT" logs --tail 20 app >&2 || true
  exit 1
fi

# ── Место на диске ──────────────────────────────────────────────────────────
#
# Каждая сборка образа оставляет слои кэша. Стенд обновляется автоматически,
# и за неделю кэш съедает диск целиком. Когда места не остаётся, ломается
# не сборка — ломается Postgres, которому некуда писать. Поэтому чистим сразу
# после успешного развёртывания, а не «когда-нибудь».
#
# Кэш моложе суток не трогаем: следующая сборка должна попасть в него,
# иначе каждое обновление стенда будет собирать всё заново.
# PRUNE=0 — не чистить: локальная копия стенда на машине разработчика, где кэш
# сборки нужен и другим проектам.
if [ "${PRUNE:-1}" = "0" ]; then
  echo "── Чистку пропускаю (PRUNE=0)"
  exit 0
fi
echo "── Чищу за собой"
docker image prune -f > /dev/null 2>&1 || true
docker builder prune -f --keep-storage 2g > /dev/null 2>&1 ||
  docker builder prune -f --filter until=24h > /dev/null 2>&1 || true

FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
echo "   свободно на диске: ${FREE_MB} МБ"
if [ "$FREE_MB" -lt 3000 ]; then
  echo "   ВНИМАНИЕ: меньше 3 ГБ. Чищу глубже — следующая сборка будет дольше." >&2
  docker builder prune -af > /dev/null 2>&1 || true
  docker image prune -af --filter until=24h > /dev/null 2>&1 || true
  FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
  echo "   стало свободно: ${FREE_MB} МБ" >&2
fi
