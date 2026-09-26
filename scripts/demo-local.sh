#!/usr/bin/env bash
# Запасной ноутбук для показа — одной командой.
#
#   scripts/demo-local.sh                 подготовить, собрать, запустить, сверить
#   SKIP_BUILD=1 scripts/demo-local.sh    то же без пересборки — если уже собрано
#
# Что делает, по порядку:
#   1. проверяет, что PostgreSQL отвечает и порт показа свободен;
#   2. создаёт базу skilllink_demo, если её нет, и применяет миграции;
#   3. перезаливает демонстрационный набор — даты в нём отсчитываются
#      от заливки, и через двое суток числа расходятся со сценарием;
#   4. собирает приложение и запускает боевую сборку на порту 3100 —
#      так же, как на стенде: вход только по паролю;
#   5. сверяет запущенное со сценарием (npm run demo:check).
#
# Зачем скрипт, а не пять команд: запасной ноутбук нужен тогда,
# когда что-то уже пошло не так, и набирать команды с переменными окружения
# в этот момент — лишний шанс ошибиться.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PORT=${PORT:-3100}
DB_NAME=skilllink_demo
DB_URL="postgresql://skilllink:skilllink@localhost:5432/${DB_NAME}?schema=public"
LOG=${TMPDIR:-/tmp}
LOG=${LOG%/}/skilllink-demo-local.log

step() { printf '\n── %s\n' "$1"; }
fail() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# brew ставит postgresql@16 без добавления в PATH — ищем и там.
pg() {
  local tool=$1
  shift
  if command -v "$tool" > /dev/null; then "$tool" "$@"
  elif [ -x "/opt/homebrew/opt/postgresql@16/bin/$tool" ]; then "/opt/homebrew/opt/postgresql@16/bin/$tool" "$@"
  elif [ -x "/usr/local/opt/postgresql@16/bin/$tool" ]; then "/usr/local/opt/postgresql@16/bin/$tool" "$@"
  else fail "не найден $tool — установлен ли PostgreSQL 16? (brew install postgresql@16)"
  fi
}

step "PostgreSQL"
pg pg_isready -h localhost -p 5432 > /dev/null ||
  fail "PostgreSQL не отвечает на localhost:5432. Запустите: brew services start postgresql@16"
echo "   отвечает"

step "Порт $PORT"
if lsof -iTCP:"$PORT" -sTCP:LISTEN -t > /dev/null 2>&1; then
  PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t | head -1)
  fail "порт $PORT уже занят процессом $PID ($(ps -o comm= -p "$PID")). Остановите его: kill $PID"
fi
# Сервер разработки из этой же папки перетирает сборку — отсюда внезапные 404.
for pid in $(pgrep -f "next-server|next dev" || true); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  if [ "$cwd" = "$PWD" ]; then
    fail "из этой папки уже запущен сервер Next (процесс $pid) — он перетрёт сборку. Остановите: kill $pid"
  fi
done
echo "   свободен"

step "База $DB_NAME"
if pg psql -h localhost -U skilllink -d postgres -Atc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
  echo "   есть"
else
  pg createdb -h localhost -U skilllink "$DB_NAME"
  echo "   создана"
fi
DATABASE_URL="$DB_URL" npx prisma migrate deploy > "$LOG" 2>&1 ||
  { tail -20 "$LOG" >&2; fail "миграции не применились — журнал: $LOG"; }
echo "   миграции применены"

step "Демонстрационный набор"
DATABASE_URL="$DB_URL" npm run -s db:seed > "$LOG" 2>&1 ||
  { tail -20 "$LOG" >&2; fail "набор не залился — журнал: $LOG"; }
echo "   залит заново: числа сценария держатся двое суток"

# Пароль набора: из .env, если там задан свой, иначе — по умолчанию.
PASSWORD=$(sed -n 's/^SEED_DEMO_PASSWORD="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env 2>/dev/null | head -1)
PASSWORD=${PASSWORD:-skilllink}

# Шрифт подключён через next/font/google и скачивается при сборке: без интернета
# сборка не пройдёт. Поэтому первый запуск — заранее, с сетью, а в момент, когда
# сети нет, берём готовую сборку.
if [ "${SKIP_BUILD:-}" != "1" ] && ! curl -fsS -o /dev/null --max-time 4 https://fonts.googleapis.com 2>/dev/null; then
  if [ -f .next/BUILD_ID ]; then
    echo
    echo "   нет интернета — собрать нельзя (шрифт качается при сборке), беру готовую сборку"
    SKIP_BUILD=1
  else
    fail "нет интернета, а готовой сборки нет. Соберите заранее, пока сеть есть: scripts/demo-local.sh"
  fi
fi

if [ "${SKIP_BUILD:-}" = "1" ]; then
  step "Сборка — пропущена, используется готовая"
  [ -f .next/BUILD_ID ] || fail "готовой сборки нет — запустите без SKIP_BUILD"
else
  step "Сборка (около минуты)"
  npm run -s build > "$LOG" 2>&1 || { tail -30 "$LOG" >&2; fail "сборка не прошла — журнал: $LOG"; }
  echo "   собрано"
fi

step "Запуск на http://localhost:$PORT"
# DEMO_AUTH_ENABLED=false — как на стенде: без него локальный .env пускает без пароля.
DATABASE_URL="$DB_URL" AUTH_URL="http://localhost:$PORT" PORT="$PORT" DEMO_AUTH_ENABLED=false \
  nohup npm start > "$LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -20 "$LOG" >&2; fail "сервер остановился — журнал: $LOG"; }
  sleep 1
done
# Живость — процесс поднялся; готовность — видит базу и миграции (решение 118).
curl -fsS -o /dev/null --max-time 5 "http://localhost:$PORT/api/ready" ||
  fail "сервер не готов: /api/ready не 200 (база или миграции) — журнал: $LOG"
echo "   работает (процесс $SERVER_PID)"

step "Сверка со сценарием"
SEED_DEMO_PASSWORD="$PASSWORD" npx tsx scripts/demo-check.ts "http://localhost:$PORT" || {
  echo
  echo "Сервер оставлен работать: http://localhost:$PORT. Остановить: kill $SERVER_PID"
  fail "стенд на ноутбуке расходится со сценарием — смотрите строки FAIL выше"
}

cat <<DONE

━━ Готово: http://localhost:$PORT
   Вход: manager@skilllink.demo, представитель вуза — rep@spbgu.example.invalid
   Пароль: $([ "$PASSWORD" = "skilllink" ] && echo "skilllink (не пароль стенда)" || echo "из SEED_DEMO_PASSWORD в .env")
   Входить после этого запуска: перезаливка создаёт пользователей заново.
   Остановить: kill $SERVER_PID    Журнал: $LOG
DONE
