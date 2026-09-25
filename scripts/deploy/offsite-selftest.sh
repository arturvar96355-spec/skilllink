#!/usr/bin/env bash
# Проверка копирования вне сервера без облака и без сервера (решение 114).
#
#   scripts/deploy/offsite-selftest.sh [база-источник]
#   PG_BIN=/usr/lib/postgresql/16/bin scripts/deploy/offsite-selftest.sh skilllink
#
# Снимает pg_dump -Fc локальной базы (по умолчанию skilllink_main) и прогоняет
# backup-offsite.sh и restore-offsite.sh по-настоящему, только aws-cli заменён
# заглушкой (бакет — папка), а контейнер базы — локальными pg_restore и psql. Проверяет:
#   * загрузку, сверку размера, расшифровку и восстановление в новую базу —
#     число строк каждой таблицы совпадает с источником;
#   * отказы: оборванная, устаревшая, отсутствующая копия, чужой пароль, испорченный
#     объект, недоступное хранилище, восстановление в рабочую или существующую базу;
#   * предупреждение о копиях старше срока (код 2);
#   * что секреты не попали ни в журнал, ни в командную строку aws-cli.
# Всё временное — во временном каталоге; проверочная база удаляется в конце.
set -euo pipefail
# Копии базы — персональные данные, даже в проверке: файлы только владельцу.
umask 077

SOURCE_DB=${1:-skilllink_main}
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
CHECK_DB=offsite_selftest_$$

cleanup() {
  "$PG_BIN/psql" -d postgres -qc "drop database if exists $CHECK_DB" > /dev/null 2>&1 || true
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
# expect <что проверяем> <ожидаемый код выхода> <команда...>
expect() {
  local what=$1 want=$2 got=0
  shift 2
  "$@" > "$TMP/last.out" 2>&1 || got=$?
  if [ "$got" = "$want" ]; then
    ok "$what (код $got)"
  else
    bad "$what: код $got, ждали $want"
    tail -n 8 "$TMP/last.out" "$BACKUP_DIR/offsite.log" 2> /dev/null | sed 's/^/       /'
  fi
}
# Число строк каждой таблицы базы — для сравнения источника и восстановленной копии.
row_counts() {
  "$PG_BIN/psql" -d "$1" -F ' ' -Atc "
    select table_name,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name"
}

echo "Копии вне сервера: проверка без облака (источник — база $SOURCE_DB)"

# ── Окружение: бакет-папка, заглушка aws-cli, настройки ─────────────────────
cat > "$TMP/aws-stub.sh" << 'STUB'
#!/usr/bin/env bash
# Заглушка aws-cli: бакет — папка $AWS_STUB_DIR. Понимает ровно то, что зовут скрипты,
# и ведёт себя как настоящий: ls по пустому префиксу — код 1, нет объекта — код 1.
set -euo pipefail
printf '%s\n' "$*" >> "$AWS_STUB_DIR/.calls"
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "Unable to locate credentials" >&2
  exit 255
fi
if [ "${AWS_STUB_FAIL:-}" = 1 ]; then
  echo "Could not connect to the endpoint URL" >&2
  exit 1
fi
path() { printf '%s/%s' "$AWS_STUB_DIR" "${1#s3://}"; }
case "$1 $2" in
  "s3 cp")
    if [ "$3" = - ]; then
      mkdir -p "$(dirname "$(path "$4")")"
      cat > "$(path "$4")"
    else
      [ -f "$(path "$3")" ] || { echo "download failed: An error occurred (404) when calling the HeadObject operation: Not Found" >&2; exit 1; }
      cat "$(path "$3")"
    fi
    ;;
  "s3 ls")
    dir=$(path "$3")
    [ -d "$dir" ] || exit 1
    for file in "$dir"*; do
      [ -f "$file" ] || continue
      printf '%s %10s %s\n' "$(date -r "$file" '+%F %T')" "$(wc -c < "$file" | tr -d ' ')" "$(basename "$file")"
    done
    ;;
  *)
    echo "заглушка: не умею $*" >&2
    exit 2
    ;;
esac
STUB

SECRET="selftest-secret-$(openssl rand -hex 16)"
PASSPHRASE=$(openssl rand -base64 32)
# Пароль — в кавычках: так его может записать человек, скрипт обязан их снять.
cat > "$TMP/env.cloud" << ENV
POSTGRES_PASSWORD=не-читается-скриптами
YC_S3_BUCKET=selftest-bucket
YC_S3_ACCESS_KEY_ID=SELFTESTKEYID
YC_S3_SECRET_ACCESS_KEY=$SECRET
BACKUP_ENCRYPTION_PASSPHRASE="$PASSPHRASE"
ENV
chmod 600 "$TMP/env.cloud"

export ENV_FILE="$TMP/env.cloud"
export BACKUP_DIR="$TMP/backups"
export AWS_STUB_DIR="$TMP/bucket"
export AWS_CMD="bash $TMP/aws-stub.sh"
export PG_BIN
DB_USER=$(whoami)
export DB_USER
export DB_NAME="$SOURCE_DB"
mkdir -p "$BACKUP_DIR" "$AWS_STUB_DIR"

TODAY=$(date +%F)
DUMP="$BACKUP_DIR/skilllink-$TODAY.dump"
OBJECT="$AWS_STUB_DIR/selftest-bucket/skilllink/skilllink-$TODAY.dump.enc"
BACKUP="$HERE/backup-offsite.sh"
RESTORE="$HERE/restore-offsite.sh"

# Та же команда, что у ночного cron, только локальным pg_dump.
"$PG_BIN/pg_dump" -Fc -d "$SOURCE_DB" > "$DUMP"
# Прошлая копия рядом: скрипт обязан взять свежую, а не первую попавшуюся.
cp "$DUMP" "$BACKUP_DIR/skilllink-2000-01-01.dump"

# ── Основной путь ───────────────────────────────────────────────────────────
echo "── Загрузка"
expect "ночная копия зашифрована и загружена" 0 bash "$BACKUP"
if [ -f "$OBJECT" ] && [ -f "$OBJECT.sha256" ]; then ok "в бакете копия и её контрольная сумма"; else bad "в бакете нет $OBJECT"; fi
if [ "$(head -c 5 "$OBJECT" 2> /dev/null)" != PGDMP ] && [ "$(head -c 8 "$OBJECT" 2> /dev/null)" = Salted__ ]; then
  ok "в бакете шифр, а не копия базы (заголовок Salted__, не PGDMP)"
else
  bad "объект в бакете не зашифрован"
fi
if grep -q "ГОТОВО: skilllink-$TODAY.dump" "$BACKUP_DIR/offsite.log"; then ok "итог записан в offsite.log"; else bad "в offsite.log нет итога"; fi

echo "── Восстановление"
expect "CHECK_ONLY: скачана, сверена, расшифрована, прочитана" 0 env CHECK_ONLY=1 bash "$RESTORE"
expect "самая свежая копия восстановлена в новую базу" 0 bash "$RESTORE" latest "$CHECK_DB"
if [ "$(row_counts "$SOURCE_DB")" = "$(row_counts "$CHECK_DB")" ]; then
  ok "строки всех $(row_counts "$SOURCE_DB" | grep -c .) таблиц совпали с источником"
else
  bad "восстановленная база отличается от источника"
  diff <(row_counts "$SOURCE_DB") <(row_counts "$CHECK_DB") | head -10 | sed 's/^/       /'
fi
expect "копия за дату восстанавливается по дате (CHECK_ONLY)" 0 env CHECK_ONLY=1 bash "$RESTORE" "$TODAY"

# ── Отказы ──────────────────────────────────────────────────────────────────
echo "── Отказы"
expect "в рабочую базу восстанавливать нельзя" 1 bash "$RESTORE" latest "$SOURCE_DB"
expect "в существующую базу восстанавливать нельзя" 1 bash "$RESTORE" latest "$CHECK_DB"
expect "имя базы с кавычкой отвергнуто" 1 bash "$RESTORE" latest "x\"; drop database y; --"
expect "копии за дату нет — понятный отказ" 1 env CHECK_ONLY=1 bash "$RESTORE" 1999-01-01

sed "s|^BACKUP_ENCRYPTION_PASSPHRASE=.*|BACKUP_ENCRYPTION_PASSPHRASE=$(openssl rand -base64 32)|" "$TMP/env.cloud" > "$TMP/env.wrong"
expect "чужой пароль шифрования — не расшифровывается" 1 env ENV_FILE="$TMP/env.wrong" CHECK_ONLY=1 bash "$RESTORE"

cp "$OBJECT" "$TMP/object.bak"
printf 'XXXX' | dd of="$OBJECT" bs=1 seek=4096 conv=notrunc 2> /dev/null
expect "испорченный в бакете объект пойман контрольной суммой" 1 env CHECK_ONLY=1 bash "$RESTORE"
cp "$TMP/object.bak" "$OBJECT"

cp "$DUMP" "$TMP/dump.bak"
head -c $(($(wc -c < "$TMP/dump.bak") / 2)) "$TMP/dump.bak" > "$DUMP"
expect "оборванная ночная копия не уходит в облако" 1 bash "$BACKUP"
# Оглавление в начале файла цело, оборваны данные: pg_restore -l такую пропускает.
head -c $(($(wc -c < "$TMP/dump.bak") * 9 / 10)) "$TMP/dump.bak" > "$DUMP"
expect "копия с целым оглавлением, но оборванными данными не уходит" 1 bash "$BACKUP"
: > "$DUMP"
expect "пустая ночная копия не уходит в облако" 1 bash "$BACKUP"
cp "$TMP/dump.bak" "$DUMP"

touch -t 200001010300 "$DUMP"
expect "ночная копия не снялась (свежей нет) — сбой" 1 bash "$BACKUP"
touch "$DUMP"

grep -v '^BACKUP_ENCRYPTION_PASSPHRASE=' "$TMP/env.cloud" > "$TMP/env.nopass"
expect "без пароля шифрования не загружает" 1 env ENV_FILE="$TMP/env.nopass" bash "$BACKUP"
sed 's|^YC_S3_BUCKET=.*|YC_S3_BUCKET=Bad/Bucket|' "$TMP/env.cloud" > "$TMP/env.badbucket"
expect "кривое имя бакета отвергнуто" 1 env ENV_FILE="$TMP/env.badbucket" bash "$BACKUP"
expect "хранилище недоступно — сбой, а не тишина" 1 env AWS_STUB_FAIL=1 bash "$BACKUP"

# Копия, загруженная 40 суток назад: правило жизненного цикла её бы уже удалило.
OLD="$AWS_STUB_DIR/selftest-bucket/skilllink/skilllink-2000-01-01.dump.enc"
cp "$OBJECT" "$OLD"
touch -t "$(date -v-40d +%Y%m%d0300 2> /dev/null || date -d '-40 days' +%Y%m%d0300)" "$OLD"
expect "копия старше срока в бакете — загружено с предупреждением" 2 bash "$BACKUP"
rm -f "$OLD"
expect "после уборки — снова без предупреждений" 0 bash "$BACKUP"

# ── Секреты ─────────────────────────────────────────────────────────────────
echo "── Секреты"
if grep -rqF -e "$SECRET" -e "$PASSPHRASE" "$BACKUP_DIR" "$AWS_STUB_DIR/.calls"; then
  bad "секрет попал в журнал или в командную строку aws-cli"
else
  ok "ни ключа хранилища, ни пароля шифрования нет в журнале и в командной строке aws-cli"
fi
if find "$BACKUP_DIR" -name '.offsite.*' -o -name '.restore.*' | grep -q .; then
  bad "остались временные файлы (расшифрованные копии)"
else
  ok "временные и расшифрованные файлы удалены"
fi

echo
if [ "$failed" -gt 0 ]; then
  printf '  \033[31mПроблем: %s\033[0m (пройдено %s)\n' "$failed" "$passed"
  exit 1
fi
printf '  \033[32mВсе проверки пройдены: %s\033[0m\n' "$passed"
