#!/usr/bin/env bash
# Восстановление копии из Yandex Object Storage в НОВУЮ базу — для проверки (решение 114).
# Рабочую базу не трогает: восстановить в неё скрипт откажется.
#
#   bash ~/skilllink/app/scripts/deploy/restore-offsite.sh [ДАТА] [НОВАЯ_БАЗА]
#
#   restore-offsite.sh                         # самая свежая копия → база restored_ГГГГММДД
#   restore-offsite.sh 2026-09-25              # копия за дату
#   restore-offsite.sh 2026-09-25 check_0925   # в базу с выбранным именем
#   CHECK_ONLY=1 restore-offsite.sh            # скачать, сверить, расшифровать, проверить — без базы
#
# Запускается на сервере стенда: pg_restore и psql — в контейнере базы, aws-cli — в
# docker-образе. Настройки те же, что у backup-offsite.sh (~/skilllink/.env.cloud).
#
# Восстановленная база содержит персональные данные: проверили — удалите её
# (команда в конце вывода). Расшифрованный файл удаляется сам.
set -euo pipefail
set +x
umask 077

# shellcheck source=scripts/deploy/offsite-lib.sh
. "$(dirname "$0")/offsite-lib.sh"

DATE=${1:-latest}
TARGET_DB=${2:-}

if [ "$DATE" != latest ] && ! printf '%s' "$DATE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "Использование: restore-offsite.sh [ГГГГ-ММ-ДД|latest] [имя_новой_базы]" >&2
  exit 1
fi

WORK=""
cleanup() { [ -z "$WORK" ] || rm -rf "$WORK"; }
trap cleanup EXIT

load_settings
mkdir -p "$BACKUP_DIR"
WORK=$(mktemp -d "$BACKUP_DIR/.restore.XXXXXX")

# ── 1. Какую копию берём ────────────────────────────────────────────────────
copies=$(list_copies) || fail "не удалось получить список копий в бакете"
[ -n "$copies" ] || fail "в s3://$S3_BUCKET/$S3_PREFIX нет ни одной копии"
if [ "$DATE" = latest ]; then
  object=$(printf '%s\n' "$copies" | tail -n 1 | awk '{ print $4 }')
else
  object=$(printf '%s\n' "$copies" | awk -v n="skilllink-$DATE.dump.enc" '$4 == n { print $4 }')
  [ -n "$object" ] || fail "копии за $DATE в бакете нет. Есть: $(printf '%s\n' "$copies" | awk '{ print $4 }' | tr '\n' ' ')"
fi
copy_date=$(printf '%s' "$object" | sed -E 's/^skilllink-([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/')
TARGET_DB=${TARGET_DB:-restored_$(printf '%s' "$copy_date" | tr -d '-')}

# Имя базы встаёт в SQL — только простое имя, и никогда не рабочая база.
printf '%s' "$TARGET_DB" | grep -Eq '^[a-z_][a-z0-9_]{0,62}$' ||
  fail "имя базы «$TARGET_DB»: только строчные латинские буквы, цифры и _"
case "$TARGET_DB" in
  "$DB_NAME" | postgres | template0 | template1)
    fail "в «$TARGET_DB» восстанавливать нельзя: это рабочая или служебная база. Выберите новое имя"
    ;;
esac
if [ "${CHECK_ONLY:-}" != 1 ]; then
  exists=$(pg_tool psql -d postgres -Atc "select 1 from pg_database where datname = '$TARGET_DB'") ||
    fail "не удалось подключиться к базе (контейнер $PG_CONTAINER запущен?)"
  [ -z "$exists" ] || fail "база $TARGET_DB уже есть — выберите другое имя или удалите её"
fi

# ── 2. Скачать и сверить ────────────────────────────────────────────────────
say "скачиваю s3://$S3_BUCKET/$S3_PREFIX$object"
aws_run s3 cp "s3://$S3_BUCKET/$S3_PREFIX$object" - > "$WORK/copy.enc" ||
  fail "не удалось скачать копию — выше ответ хранилища"
if aws_run s3 cp "s3://$S3_BUCKET/$S3_PREFIX$object.sha256" - > "$WORK/copy.sha256" 2> /dev/null; then
  expected=$(awk '{ print $1 }' "$WORK/copy.sha256")
  [ "$expected" = "$(sha256_of "$WORK/copy.enc")" ] ||
    fail "контрольная сумма не совпала: копия испорчена при передаче или в хранилище"
  say "контрольная сумма совпала"
else
  warn "контрольной суммы в бакете нет — сверяю только расшифровкой"
fi

# ── 3. Расшифровать и проверить ─────────────────────────────────────────────
decrypt_file "$WORK/copy.enc" "$WORK/copy.dump" 2> "$WORK/enc.err" ||
  fail "копия не расшифровывается: BACKUP_ENCRYPTION_PASSPHRASE не тот, которым её шифровали"
tables=$(check_dump "$WORK/copy.dump" "$WORK/pg.err")
say "копия $object цела: $(human_size "$(size_of "$WORK/copy.dump")"), таблиц с данными: $tables"

if [ "${CHECK_ONLY:-}" = 1 ]; then
  say "проверка копии без восстановления: $object цела, таблиц с данными $tables" >> "${OFFSITE_LOG:-$BACKUP_DIR/offsite.log}"
  say "ГОТОВО: копия скачивается, расшифровывается и читается целиком (CHECK_ONLY=1, база не создавалась)"
  exit 0
fi

# ── 4. Восстановить в новую базу ────────────────────────────────────────────
# Без владельцев и прав: это проверочная копия, роль приложения доступа к ней
# не получает. Если по ней будут работать — права выдаёт create-app-role.sql.
say "создаю базу $TARGET_DB и восстанавливаю"
pg_tool psql -d postgres -v ON_ERROR_STOP=1 -qc "create database \"$TARGET_DB\"" ||
  fail "не удалось создать базу $TARGET_DB"
pg_tool pg_restore -d "$TARGET_DB" --no-owner --no-acl --exit-on-error < "$WORK/copy.dump" 2> "$WORK/pg.err" ||
  fail "восстановление остановилось на ошибке: $(head -c 500 "$WORK/pg.err"). Недовосстановленную базу удалите: drop database $TARGET_DB"

# ── 5. Что восстановилось ───────────────────────────────────────────────────
# Точный счёт строк каждой таблицы: статистики у только что восстановленной базы нет.
restored=$(pg_tool psql -d "$TARGET_DB" -Atc "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
say "таблиц восстановлено: $restored (с данными в копии: $tables)"
pg_tool psql -d "$TARGET_DB" -F ' ' -Atc "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name" | awk '{ printf "   %-40s %s\n", $1, $2 }'

# Отметка в общем журнале: когда восстановление последний раз проверяли.
say "проверка восстановления: $object → база $TARGET_DB, таблиц $restored" >> "${OFFSITE_LOG:-$BACKUP_DIR/offsite.log}"

say "ГОТОВО: копия $object восстановлена в базу $TARGET_DB, рабочая база $DB_NAME не тронута"
if [ -z "${PG_BIN:-}" ]; then
  drop="docker exec -i $PG_CONTAINER psql -U $DB_USER -d postgres -c 'drop database $TARGET_DB'"
else
  drop="$PG_BIN/psql -U $DB_USER -d postgres -c 'drop database $TARGET_DB'"
fi
echo "   В базе персональные данные. Проверили — удалите её:"
echo "   $drop"
