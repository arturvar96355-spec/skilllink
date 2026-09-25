# Общее для backup-offsite.sh и restore-offsite.sh (решение 114). Сам не запускается —
# подключается через source.
#
# Секреты в этом файле нигде не печатаются и не попадают в командную строку:
# ключ хранилища уходит в aws-cli через окружение одной команды, пароль шифрования —
# в openssl так же (-pass env:). В `ps` видны только имена переменных.
# shellcheck shell=bash

set +x

ENV_FILE=${ENV_FILE:-$HOME/skilllink/.env.cloud}
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups}

S3_ENDPOINT=https://storage.yandexcloud.net
S3_REGION=ru-central1
# Все копии лежат под этим префиксом. На него же настраивается правило жизненного
# цикла бакета (docs/DEPLOY.md, «Копии вне сервера»).
S3_PREFIX=skilllink/
# Сколько суток копии живут в бакете. Удаляет их правило жизненного цикла, а не скрипт:
# у ключа роль storage.uploader, удалять объекты она не позволяет — и это намеренно.
# shellcheck disable=SC2034 # читает backup-offsite.sh
KEEP_DAYS=30

# Образ aws-cli: запускается на время команды и удаляется, на сервер ничего не ставится.
AWS_CLI_IMAGE=${AWS_CLI_IMAGE:-amazon/aws-cli}
PG_CONTAINER=${PG_CONTAINER:-skilllink-postgres}
# Роль и рабочая база — те же, что в ночной копии (cron владельца, DEPLOY.md, раздел 6).
DB_USER=${DB_USER:-skilllink}
DB_NAME=${DB_NAME:-skilllink}

# Шифрование: AES-256, ключ выводится из пароля через PBKDF2. Параметры менять только
# вместе с расшифровкой: копия, зашифрованная прежними, прежними и открывается.
ENC_ARGS=(-aes-256-cbc -pbkdf2 -iter 200000 -md sha256)

say() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
warn() { say "ВНИМАНИЕ: $*" >&2; }
fail() {
  say "СБОЙ: $*" >&2
  exit 1
}

# Значение переменной из ENV_FILE; кавычки вокруг значения снимаются.
# Файл не исполняется через source: в нём могут быть строки, которые bash понял бы иначе.
env_get() {
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1) || true
  line=${line#*=}
  case "$line" in
    \"*\") line=${line#\"} && line=${line%\"} ;;
    \'*\') line=${line#\'} && line=${line%\'} ;;
  esac
  printf '%s' "$line"
}

load_settings() {
  [ -r "$ENV_FILE" ] || fail "нет файла настроек $ENV_FILE"
  if [ -n "$(find "$ENV_FILE" -perm -004 2> /dev/null)" ]; then
    warn "$ENV_FILE могут читать все пользователи машины: chmod 600 $ENV_FILE"
  fi

  S3_BUCKET=$(env_get YC_S3_BUCKET)
  S3_KEY_ID=$(env_get YC_S3_ACCESS_KEY_ID)
  S3_SECRET=$(env_get YC_S3_SECRET_ACCESS_KEY)
  BACKUP_PASSPHRASE=$(env_get BACKUP_ENCRYPTION_PASSPHRASE)

  local missing=""
  [ -n "$S3_BUCKET" ] || missing="$missing YC_S3_BUCKET"
  [ -n "$S3_KEY_ID" ] || missing="$missing YC_S3_ACCESS_KEY_ID"
  [ -n "$S3_SECRET" ] || missing="$missing YC_S3_SECRET_ACCESS_KEY"
  [ -n "$BACKUP_PASSPHRASE" ] || missing="$missing BACKUP_ENCRYPTION_PASSPHRASE"
  [ -z "$missing" ] || fail "в $ENV_FILE не заданы:$missing (docs/DEPLOY.md, «Копии вне сервера»)"

  # Имя бакета попадает в адрес объекта; проверяем, что это именно имя.
  printf '%s' "$S3_BUCKET" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' ||
    fail "YC_S3_BUCKET не похоже на имя бакета: строчные латинские буквы, цифры, точка и дефис, 3–63 символа"
  [ "${#BACKUP_PASSPHRASE}" -ge 20 ] ||
    fail "BACKUP_ENCRYPTION_PASSPHRASE короче 20 символов — сгенерируйте: openssl rand -base64 32"
}

# aws-cli с ключом из настроек. AWS_CMD подменяет его заглушкой (offsite-selftest.sh).
aws_run() {
  if [ -n "${AWS_CMD:-}" ]; then
    # shellcheck disable=SC2086 # команда из нескольких слов
    AWS_ACCESS_KEY_ID="$S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET" $AWS_CMD "$@"
    return
  fi
  # -e ИМЯ без значения: docker берёт значение из окружения и не показывает его в ps.
  # Проверка контрольных сумм — только когда её требует запрос: новые aws-cli по
  # умолчанию шлют CRC-заголовки, которые S3-совместимые хранилища понимают не всегда.
  # Предел памяти — чтобы загрузка не отняла память у базы на маленькой машине.
  AWS_ACCESS_KEY_ID="$S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
    docker run --rm -i --memory 512m \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    -e AWS_DEFAULT_REGION="$S3_REGION" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    "$AWS_CLI_IMAGE" --endpoint-url "$S3_ENDPOINT" \
    --cli-connect-timeout 30 --cli-read-timeout 300 "$@"
}

# pg_restore и psql: в контейнере базы (на сервере ничего не ставится) или локальными
# программами из каталога PG_BIN (offsite-selftest.sh).
pg_tool() {
  local tool=$1
  shift
  if [ -n "${PG_BIN:-}" ]; then
    "$PG_BIN/$tool" -U "$DB_USER" "$@"
  else
    docker exec -i "$PG_CONTAINER" "$tool" -U "$DB_USER" "$@"
  fi
}

# Проверка копии целиком, без восстановления: оглавление читается (-l), и все данные
# дочитываются до конца (-f /dev/null). Одного -l мало: оглавление лежит в начале файла,
# и оборванная на середине копия его проходит. Печатает число таблиц с данными.
check_dump() {
  local file=$1 err=$2 toc tables
  toc=$(pg_tool pg_restore -l < "$file" 2> "$err") ||
    fail "копия $(basename "$file") не читается: $(head -c 300 "$err")"
  tables=$(printf '%s\n' "$toc" | grep -c ' TABLE DATA ' || true)
  [ "$tables" -gt 0 ] || fail "в копии $(basename "$file") нет данных ни одной таблицы"
  pg_tool pg_restore -f /dev/null < "$file" 2> "$err" ||
    fail "копия $(basename "$file") оборвана или повреждена: $(head -c 300 "$err")"
  printf '%s' "$tables"
}

encrypt_file() {
  OFFSITE_PASSPHRASE="$BACKUP_PASSPHRASE" \
    openssl enc -e "${ENC_ARGS[@]}" -salt -pass env:OFFSITE_PASSPHRASE -in "$1" -out "$2"
}

decrypt_file() {
  OFFSITE_PASSPHRASE="$BACKUP_PASSPHRASE" \
    openssl enc -d "${ENC_ARGS[@]}" -pass env:OFFSITE_PASSPHRASE -in "$1" -out "$2"
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

size_of() { wc -c < "$1" | tr -d ' '; }

human_size() {
  awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f МБ", b / 1048576; else printf "%.0f КБ", b / 1024 }'
}

# Дата N суток назад, ГГГГ-ММ-ДД: GNU date на сервере, BSD date на маке.
days_ago() { date -d "-$1 days" +%F 2> /dev/null || date -v-"$1"d +%F; }

# Копии в бакете: строки «дата время размер имя» из `aws s3 ls`, только наши объекты,
# по возрастанию имени (в имени дата — значит, и по времени).
list_copies() {
  aws_run s3 ls "s3://$S3_BUCKET/$S3_PREFIX" |
    awk '$4 ~ /^skilllink-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].*\.dump\.enc$/' |
    sort -k4
}
