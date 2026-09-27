#!/usr/bin/env bash
# Проверка ночной копии (scripts/ops/backup.sh, решение 216) и учений по восстановлению
# (restore-drill.sh) на своей машине — тем же путём, что на сервере: pg_dump в контейнере
# базы через `docker exec`, том загрузок читает `docker run … tar`.
#
#   bash scripts/ops/backup.test.sh
#
# Нужен только docker (и образ postgres:16-alpine, TEST_PG_IMAGE — другой). Поднимает
# одноразовый PostgreSQL в контейнере skilllink-backuptest-<pid> без сети и без портов
# и тома skilllink-backuptest-<pid>-*; всё удаляется в конце, даже при сбое.
#
# docker подменён в PATH обёрткой: по FAKE_PG_DUMP она изображает упавший pg_dump
# (fail — кусок файла и код 1; empty — код 0 и ни байта; truncated — код 0, но копия
# оборвана на 80%), остальные команды передаёт настоящему docker. Проверяется:
#   * удачная ночь: копия базы и архив тома рядом с .sha256, права 600, файлы из тома
#     в архиве те же до байта;
#   * упавший pg_dump — код 1, строка «ОШИБКА РЕЗЕРВНОЙ КОПИИ» в журнале, оповещение,
#     прошлая копия за сегодня и её .sha256 не тронуты, временных файлов не осталось;
#     старые копии в такую ночь не удаляются;
#   * следующая удачная ночь — «восстановилось»;
#   * нет тома — ошибка копии файлов, копия базы при этом снята; пустой том — не ошибка;
#   * restore-drill.sh: восстанавливает базу и читает архив; испорченный или
#     нечитаемый архив — учения провалены.
# Оповещения — ALERT_DRY_RUN=1: только печать в журнал, в Telegram ничего не уходит.
# Код выхода: 0 — все проверки прошли, 1 — нет.
set -uo pipefail
umask 077

HERE=$(cd "$(dirname "$0")" && pwd)
REAL_DOCKER=$(command -v docker) || { echo "нужен docker" >&2; exit 1; }
IMAGE=${TEST_PG_IMAGE:-postgres:16-alpine}
TAG=skilllink-backuptest-$$
VOL=$TAG-uploads
EMPTY_VOL=$TAG-empty
TMP=$(mktemp -d)

cleanup() {
  "$REAL_DOCKER" rm -f "$TAG" > /dev/null 2>&1 || true
  "$REAL_DOCKER" volume rm -f "$VOL" "$EMPTY_VOL" > /dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

passed=0
failed=0
ok() {
  printf '  \033[32mOK\033[0m   %s\n' "$1"
  passed=$((passed + 1))
}
bad() {
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
  failed=$((failed + 1))
}
check() { # check <что проверяем> <команда...>
  local what=$1
  shift
  if "$@"; then ok "$what"; else bad "$what"; fi
}
# run <ожидаемый код> <что проверяем> <команда...>: журнал этого запуска — в $TMP/last.log.
run() {
  local want=$1 what=$2 got=0 before
  shift 2
  before=0
  [ -f "$BACKUP_DIR/backup.log" ] && before=$(wc -c < "$BACKUP_DIR/backup.log")
  "$@" > "$TMP/last.out" 2>&1 || got=$?
  { tail -c +$((before + 1)) "$BACKUP_DIR/backup.log" 2> /dev/null; cat "$TMP/last.out"; } > "$TMP/last.log"
  if [ "$got" = "$want" ]; then
    ok "$what (код $got)"
  else
    bad "$what: код $got, ждали $want"
    tail -n 12 "$TMP/last.log" | sed 's/^/       /'
  fi
}
logged() { grep -qF -- "$1" "$TMP/last.log"; }
sha() { shasum -a 256 "$1" 2> /dev/null | cut -d' ' -f1 || sha256sum "$1" | cut -d' ' -f1; }
mode_of() { stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1"; }

echo "Ночная копия и учения: проверка на одноразовой базе ($TAG)"

# ── Окружение ───────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin" "$TMP/backups" "$TMP/alerts"
cat > "$TMP/bin/docker" << 'FAKE'
#!/usr/bin/env bash
# Подменный docker: при FAKE_PG_DUMP изображает сбой pg_dump, остальное — настоящему docker.
if [ "${1:-}" = exec ] && [ -n "${FAKE_PG_DUMP:-}" ]; then
  for arg in "$@"; do
    [ "$arg" = pg_dump ] || continue
    case $FAKE_PG_DUMP in
      fail)
        printf 'PGDMP\001\016\000обрыв'
        echo 'pg_dump: error: connection to server was lost' >&2
        exit 1
        ;;
      empty) exit 0 ;;
      truncated)
        "$REAL_DOCKER" "$@" > "$FAKE_TMP/full.dump" || exit $?
        head -c $(($(wc -c < "$FAKE_TMP/full.dump") * 8 / 10)) "$FAKE_TMP/full.dump"
        exit 0
        ;;
    esac
  done
fi
exec "$REAL_DOCKER" "$@"
FAKE
chmod +x "$TMP/bin/docker"
: > "$TMP/env.cloud"

export REAL_DOCKER FAKE_TMP="$TMP"
export PATH="$TMP/bin:$PATH"
export BACKUP_DIR="$TMP/backups" ALERT_DIR="$TMP/alerts" ENV_FILE="$TMP/env.cloud"
export ALERT_DRY_RUN=1 ALERT_RETRY_PAUSE_S=0
export PG_CONTAINER="$TAG" DB_USER=skilllink DB_NAME=skilllink
export UPLOADS_VOLUME="$VOL" UPLOADS_TAR_IMAGE="$IMAGE"
export DRILLS_LOG="$TMP/drills.log" DRILL_TABLES="users audit_log" DRILL_IMAGE="$IMAGE"
unset PG_BIN UPLOADS_SRC

# Одноразовая база: без сети и портов, только docker exec.
"$REAL_DOCKER" run -d --rm --name "$TAG" --network none --memory 512m \
  -e POSTGRES_USER=skilllink -e POSTGRES_DB=skilllink -e POSTGRES_PASSWORD="$(openssl rand -hex 12)" \
  "$IMAGE" > /dev/null || { echo "не запустился $IMAGE" >&2; exit 1; }
for _ in $(seq 1 120); do
  "$REAL_DOCKER" exec "$TAG" psql -U skilllink -d skilllink -Atc 'select 1' > /dev/null 2>&1 && break
  sleep 0.5
done
"$REAL_DOCKER" exec -i "$TAG" psql -U skilllink -d skilllink -q -v ON_ERROR_STOP=1 << 'SQL' || { echo "база не заполнилась" >&2; exit 1; }
create table users (id serial primary key, email text not null);
insert into users (email) select 'user' || g || '@example.test' from generate_series(1, 200) g;
create table audit_log (id serial primary key, created_at timestamptz not null default now(), action text);
insert into audit_log (action) select md5(g::text) || md5((g * 7)::text) from generate_series(1, 20000) g;
SQL

# Том загрузок с тремя файлами в двух каталогах — как у приложения (/data/uploads).
"$REAL_DOCKER" volume create "$VOL" > /dev/null
"$REAL_DOCKER" volume create "$EMPTY_VOL" > /dev/null
"$REAL_DOCKER" run --rm --network none -v "$VOL:/d" --entrypoint sh "$IMAGE" -c \
  'mkdir -p /d/ab && printf "%%PDF-1.4 договор\n" > /d/ab/contract.pdf && head -c 50000 /dev/urandom > /d/scan.png && echo заметка > /d/note.txt && sha256sum /d/ab/contract.pdf | cut -d" " -f1' \
  > "$TMP/contract.sha" || { echo "том не заполнился" >&2; exit 1; }

DAY=$(date +%F)
DUMP="$BACKUP_DIR/skilllink-$DAY.dump"
FILES="$BACKUP_DIR/skilllink-uploads-$DAY.tar.gz"
BACKUP="$HERE/backup.sh"
DRILL="$HERE/restore-drill.sh"

# ── Удачная ночь ────────────────────────────────────────────────────────────
echo "── Удачная ночь"
run 0 "копия базы и архив файлов сняты" bash "$BACKUP"
check "копия базы и .sha256 на месте, сумма сходится" \
  test -s "$DUMP" -a "$(sha "$DUMP")" = "$(cut -d' ' -f1 < "$DUMP.sha256" 2> /dev/null)"
check "архив файлов и .sha256 на месте, сумма сходится" \
  test -s "$FILES" -a "$(sha "$FILES")" = "$(cut -d' ' -f1 < "$FILES.sha256" 2> /dev/null)"
check "копии — только владельцу (600)" test "$(mode_of "$DUMP")$(mode_of "$FILES")" = 600600
check "в архиве три файла тома" test "$(tar -tzf "$FILES" | grep -v '/$' | grep -c .)" = 3
tar -xzf "$FILES" -C "$TMP" ./ab/contract.pdf 2> /dev/null
check "файл из архива совпадает с файлом тома до байта" test "$(sha "$TMP/ab/contract.pdf")" = "$(cat "$TMP/contract.sha")"
check "в журнале ГОТОВО для базы и для файлов" eval 'logged "ГОТОВО: база" && logged "ГОТОВО: файлы"'
GOOD_DUMP_SHA=$(sha "$DUMP")
GOOD_SUM_FILE=$(cat "$DUMP.sha256")

# ── Упавший pg_dump ─────────────────────────────────────────────────────────
echo "── Упавший pg_dump (подменный docker в PATH)"
touch -t "$(date -v-20d +%Y%m%d0315 2> /dev/null || date -d '-20 days' +%Y%m%d0315)" "$TMP/old"
for f in skilllink-2000-01-01.dump skilllink-2000-01-01.dump.sha256 \
  skilllink-uploads-2000-01-01.tar.gz skilllink-uploads-2000-01-01.tar.gz.sha256; do
  echo старое > "$BACKUP_DIR/$f"
  touch -r "$TMP/old" "$BACKUP_DIR/$f"
done

prior_ok() {
  [ "$(sha "$DUMP")" = "$GOOD_DUMP_SHA" ] && [ "$(cat "$DUMP.sha256")" = "$GOOD_SUM_FILE" ]
}
no_leftovers() { ! find "$BACKUP_DIR" -maxdepth 1 -name '.backup-work.*' | grep -q .; }

run 1 "pg_dump упал с кодом 1 — скрипт вернул ошибку" env FAKE_PG_DUMP=fail bash "$BACKUP"
check "в журнале «ОШИБКА РЕЗЕРВНОЙ КОПИИ БАЗЫ: pg_dump завершился с кодом 1»" \
  logged "ОШИБКА РЕЗЕРВНОЙ КОПИИ БАЗЫ: pg_dump завершился с кодом 1"
check "оповещение ушло (backup, 🔴)" eval 'logged "ALERT_DRY_RUN" && logged "🔴 SkillLink · backup ·"'
check "маркер «горит» поставлен" test -f "$ALERT_DIR/backup.firing"
check "прошлая копия за сегодня и её .sha256 не тронуты" prior_ok
check "временных файлов не осталось" no_leftovers
check "в ночь сбоя старые копии базы не удалены" test -f "$BACKUP_DIR/skilllink-2000-01-01.dump"
check "архив файлов в ту же ночь снят, старые архивы — по сроку удалены" \
  eval 'logged "ГОТОВО: файлы" && test ! -f "$BACKUP_DIR/skilllink-uploads-2000-01-01.tar.gz" && test ! -f "$BACKUP_DIR/skilllink-uploads-2000-01-01.tar.gz.sha256"'

run 1 "pg_dump вернул 0 и пустой вывод — ошибка" env FAKE_PG_DUMP=empty bash "$BACKUP"
check "причина — «меньше 1 КБ»" logged "меньше 1 КБ"
check "прошлая копия не тронута" prior_ok

run 1 "pg_dump вернул 0, но копия оборвана (оглавление цело) — ошибка" env FAKE_PG_DUMP=truncated bash "$BACKUP"
check "причина — «оборвана или повреждена»" logged "оборвана или повреждена"
check "прошлая копия не тронута" prior_ok
check "временных файлов не осталось" no_leftovers

run 0 "следующая удачная ночь" bash "$BACKUP"
check "«восстановилось: backup» и маркер снят" eval 'logged "восстановилось: backup" && test ! -f "$ALERT_DIR/backup.firing"'
check "старые копии базы удалены по сроку вместе с .sha256" \
  test ! -f "$BACKUP_DIR/skilllink-2000-01-01.dump" -a ! -f "$BACKUP_DIR/skilllink-2000-01-01.dump.sha256"

# ── Учения по восстановлению ────────────────────────────────────────────────
echo "── Учения (restore-drill.sh)"
run 0 "база восстановлена, архив файлов прочитан" bash "$DRILL"
check "в строке учений — архив и три файла" eval 'logged "OK RTO=" && logged "файлы=skilllink-uploads-$DAY.tar.gz" && logged "3 шт."'
cp "$FILES" "$TMP/files.bak"
printf 'XXXX' | dd of="$FILES" bs=1 seek=200 conv=notrunc 2> /dev/null
run 1 "архив испорчен (не сходится .sha256) — учения провалены" bash "$DRILL"
check "причина — «архив испорчен»" logged "архив испорчен"
mv "$FILES.sha256" "$TMP/files.sha256.bak"
head -c 1000 "$TMP/files.bak" > "$FILES"
run 1 "архив оборван, .sha256 нет — учения провалены" bash "$DRILL"
check "причина — «не читается»" logged "не читается"
cp "$TMP/files.bak" "$FILES"
mv "$TMP/files.sha256.bak" "$FILES.sha256"

# ── Том загрузок ────────────────────────────────────────────────────────────
echo "── Том загрузок"
GOOD_FILES_SHA=$(sha "$FILES")
run 1 "тома нет — ошибка копии файлов" env UPLOADS_VOLUME="$TAG-missing" bash "$BACKUP"
check "в журнале «ОШИБКА РЕЗЕРВНОЙ КОПИИ ФАЙЛОВ», оповещение backup-files" \
  eval 'logged "ОШИБКА РЕЗЕРВНОЙ КОПИИ ФАЙЛОВ: нет тома" && logged "🔴 SkillLink · backup-files ·"'
check "копия базы в ту же ночь снята" logged "ГОТОВО: база"
check "прошлый архив не тронут" test "$(sha "$FILES")" = "$GOOD_FILES_SHA"
run 0 "пустой том — не ошибка" env UPLOADS_VOLUME="$EMPTY_VOL" bash "$BACKUP"
check "в журнале «том пуст», в архиве ни одного файла" \
  eval 'logged "том пуст" && test "$(tar -tzf "$FILES" | grep -v "/\$" | grep -c .)" = 0'
check "«восстановилось: backup-files»" logged "восстановилось: backup-files"

echo
if [ "$failed" -gt 0 ]; then
  printf '  \033[31mПроблем: %s\033[0m (пройдено %s)\n' "$failed" "$passed"
  exit 1
fi
printf '  \033[32mВсе проверки пройдены: %s\033[0m\n' "$passed"
