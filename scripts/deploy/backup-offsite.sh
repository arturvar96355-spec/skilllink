#!/usr/bin/env bash
# Копия ночной резервной копии базы и архива загруженных файлов — вне сервера,
# в Yandex Object Storage (решения 114, 216).
#
#   bash ~/skilllink/app/scripts/deploy/backup-offsite.sh
#
# Запускается на сервере из cron владельца через полчаса после ночной копии (03:15):
#   45 3 * * * bash ~/skilllink/app/scripts/deploy/backup-offsite.sh
#
# Что делает:
#   1. берёт самую свежую ~/backups/skilllink-*.dump и убеждается, что она этой ночи;
#   2. проверяет её целиком pg_restore в контейнере базы (ничего не восстанавливает);
#   3. шифрует на сервере паролем BACKUP_ENCRYPTION_PASSPHRASE и сразу проверяет,
#      что зашифрованное расшифровывается в тот же файл: в облако уходит только шифр,
#      копии содержат персональные данные;
#   4. загружает в бакет через docker-образ amazon/aws-cli — на сервер ничего не ставится;
#   5. сверяет размер в бакете;
#   6. то же — с архивом загруженных файлов той же ночи
#      (~/backups/skilllink-uploads-ГГГГ-ММ-ДД.tar.gz): сверка .sha256, `tar -tzf`,
#      шифрование тем же паролем и теми же параметрами, загрузка, сверка размера;
#   7. проверяет, что копии старше срока удаляет правило жизненного цикла бакета
#      (сам скрипт удалять не может и не должен).
#
# Итог — в ~/backups/offsite.log и оповещением alert.sh (вид `backup-offsite`).
# Код выхода: 0 — загружено всё; 1 — сбой (что именно не ушло — в строке ИТОГ);
# 2 — загружено, но есть предупреждение: в бакете копии старше срока или архива
# файлов за эту ночь нет.
#
# Настройки — в ~/skilllink/.env.cloud (docs/DEPLOY.md, «Копии вне сервера»).
# Для проверки без облака — scripts/deploy/offsite-selftest.sh.
set -euo pipefail
set +x
umask 077

# shellcheck source=scripts/deploy/offsite-lib.sh
. "$(dirname "$0")/offsite-lib.sh"

# Копия не моложе стольких часов — значит, ночная копия не снялась.
MAX_AGE_HOURS=${MAX_AGE_HOURS:-26}
LOG_FILE=${OFFSITE_LOG:-$BACKUP_DIR/offsite.log}

mkdir -p "$BACKUP_DIR"
# Журнал растёт на десяток строк за ночь; держим последние пару тысяч.
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 5000 ]; then
  tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
# Из cron — всё в журнал; руками — и в журнал, и на экран.
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >> "$LOG_FILE" 2>&1
fi

WORK=""
DB_UPLOADED=0
WARNED=0
finish() {
  local code=$? reason
  [ -n "$WORK" ] && rm -rf "$WORK"
  # Последняя причина из журнала этого запуска; `|| true` — set -e действует и здесь.
  reason=$(tail -n 20 "$LOG_FILE" 2> /dev/null | grep -E 'СБОЙ:|ВНИМАНИЕ:' | tail -n 1 | cut -d' ' -f3- | head -c 300 || true)
  case $code in
    0)
      alert_owner ok "копия вне сервера снова уходит в облако"
      ;;
    2)
      say "ИТОГ: загружено, есть предупреждение (код 2)"
      alert_owner warning "копия вне сервера загружена с предупреждением: ${reason:-см. журнал}. Журнал: $LOG_FILE"
      ;;
    *)
      if [ "$DB_UPLOADED" = 1 ]; then
        say "ИТОГ: СБОЙ — копия базы вне сервера есть, архива файлов за эту ночь нет (код $code)"
      else
        say "ИТОГ: СБОЙ, копии вне сервера за эту ночь нет (код $code)"
      fi
      alert_owner critical "ОШИБКА РЕЗЕРВНОЙ КОПИИ вне сервера: ${reason:-см. журнал}. Журнал: $LOG_FILE"
      ;;
  esac
}
# Оповещение владельцу — тем же каналом, что у ночной копии (scripts/ops/alert.sh).
# Бот не настроен — alert.sh пишет это в свой журнал и возвращает 0; здесь не мешает.
alert_owner() {
  local alert
  alert="$(dirname "$0")/../ops/alert.sh"
  [ -f "$alert" ] || return 0
  bash "$alert" backup-offsite "$1" "$2" > /dev/null 2>&1 || true
}
trap finish EXIT

say "── копия вне сервера: начало"
load_settings
WORK=$(mktemp -d "$BACKUP_DIR/.offsite.XXXXXX")

# ── 1. Самая свежая ночная копия ────────────────────────────────────────────
# В имени дата ГГГГ-ММ-ДД, поэтому последняя по имени — самая свежая.
latest=""
for file in "$BACKUP_DIR"/skilllink-*.dump; do
  [ -f "$file" ] && latest=$file
done
[ -n "$latest" ] || fail "в $BACKUP_DIR нет ни одной skilllink-*.dump — ночная копия не снимается"
name=$(basename "$latest")
if [ -n "$(find "$latest" -mmin +$((MAX_AGE_HOURS * 60)))" ]; then
  fail "самая свежая копия $name старше $MAX_AGE_HOURS ч — ночная копия (cron 03:15) не отработала, смотрите $BACKUP_DIR/backup.log"
fi

# ── 2. Копия цела ───────────────────────────────────────────────────────────
# backup.sh уже проверил её так же; здесь — ещё раз: файл мог испортиться на диске
# или быть положен руками. Оборванную или пустую копию в облако не отправляем.
tables=$(check_dump "$latest" "$WORK/pg.err")
say "копия $name цела: $(human_size "$(size_of "$latest")"), таблиц с данными: $tables"

# ── 3. Шифрование и проверка расшифровки ────────────────────────────────────
encrypted="$WORK/$name.enc"
encrypt_file "$latest" "$encrypted" 2> "$WORK/enc.err" ||
  fail "не удалось зашифровать: $(head -c 300 "$WORK/enc.err")"
decrypt_file "$encrypted" "$WORK/roundtrip.dump" 2> "$WORK/enc.err" ||
  fail "зашифрованная копия не расшифровывается тем же паролем: $(head -c 300 "$WORK/enc.err")"
[ "$(sha256_of "$WORK/roundtrip.dump")" = "$(sha256_of "$latest")" ] ||
  fail "после расшифровки копия не совпала с исходной"
rm -f "$WORK/roundtrip.dump"

# Контрольная сумма шифра — отдельным объектом: при восстановлении она отличает
# «файл испорчен при передаче» от «не тот пароль».
checksum="$WORK/$name.enc.sha256"
printf '%s  %s\n' "$(sha256_of "$encrypted")" "$name.enc" > "$checksum"

# ── 4. Загрузка ─────────────────────────────────────────────────────────────
# Имя объекта — имя ночной копии: повторный запуск за ту же ночь перезаписывает её же.
# Класс STANDARD_IA — это «холодное» хранилище Object Storage.
key="$S3_PREFIX$name.enc"
say "загружаю в s3://$S3_BUCKET/$key"
aws_run s3 cp - "s3://$S3_BUCKET/$key" --storage-class STANDARD_IA --only-show-errors < "$encrypted" ||
  fail "загрузка не удалась — выше ответ хранилища (сеть, ключ доступа, права на бакет)"
aws_run s3 cp - "s3://$S3_BUCKET/$key.sha256" --storage-class STANDARD_IA --only-show-errors < "$checksum" ||
  fail "контрольная сумма не загрузилась — выше ответ хранилища"

# ── 5. Сверка с бакетом ─────────────────────────────────────────────────────
copies=$(list_copies) || fail "не удалось получить список копий в бакете"
local_size=$(size_of "$encrypted")
remote_size=$(printf '%s\n' "$copies" | awk -v n="$name.enc" '$4 == n { print $3 }')
[ "$remote_size" = "$local_size" ] ||
  fail "в бакете $name.enc размером ${remote_size:-0} байт, а должно быть $local_size"

count=$(printf '%s\n' "$copies" | grep -c . || true)
oldest=$(printf '%s\n' "$copies" | sort -k1,1 | head -n 1 | awk '{ print $1 }')
say "ГОТОВО: $name → s3://$S3_BUCKET/$key ($(human_size "$local_size")); в бакете копий: $count, самая ранняя загружена $oldest"
DB_UPLOADED=1

# ── 6. Архив загруженных файлов той же ночи (решение 216) ───────────────────
day=${name#skilllink-}
day=${day%.dump}
files_name="skilllink-uploads-$day.tar.gz"
files="$BACKUP_DIR/$files_name"
if [ ! -f "$files" ]; then
  warn "архива файлов $files_name нет — ночная копия файлов не снялась (смотрите $BACKUP_DIR/backup.log); в облако ушла только база"
  WARNED=1
else
  if [ -f "$files.sha256" ]; then
    [ "$(sha256_of "$files")" = "$(cut -d' ' -f1 < "$files.sha256")" ] ||
      fail "архив $files_name не совпадает со своим .sha256 — испорчен на диске, в облако не отправлен"
  fi
  files_count=$(check_archive "$files" "$WORK/tar.err")
  files_enc="$WORK/$files_name.enc"
  encrypt_file "$files" "$files_enc" 2> "$WORK/enc.err" ||
    fail "не удалось зашифровать архив файлов: $(head -c 300 "$WORK/enc.err")"
  decrypt_file "$files_enc" "$WORK/roundtrip.tar.gz" 2> "$WORK/enc.err" ||
    fail "зашифрованный архив файлов не расшифровывается тем же паролем: $(head -c 300 "$WORK/enc.err")"
  [ "$(sha256_of "$WORK/roundtrip.tar.gz")" = "$(sha256_of "$files")" ] ||
    fail "после расшифровки архив файлов не совпал с исходным"
  rm -f "$WORK/roundtrip.tar.gz"
  printf '%s  %s\n' "$(sha256_of "$files_enc")" "$files_name.enc" > "$files_enc.sha256"

  files_key="$S3_PREFIX$files_name.enc"
  say "загружаю в s3://$S3_BUCKET/$files_key"
  aws_run s3 cp - "s3://$S3_BUCKET/$files_key" --storage-class STANDARD_IA --only-show-errors < "$files_enc" ||
    fail "архив файлов не загрузился — выше ответ хранилища"
  aws_run s3 cp - "s3://$S3_BUCKET/$files_key.sha256" --storage-class STANDARD_IA --only-show-errors < "$files_enc.sha256" ||
    fail "контрольная сумма архива файлов не загрузилась — выше ответ хранилища"
  uploads_list=$(list_uploads) || fail "не удалось получить список архивов файлов в бакете"
  files_local=$(size_of "$files_enc")
  files_remote=$(printf '%s\n' "$uploads_list" | awk -v n="$files_name.enc" '$4 == n { print $3 }')
  [ "$files_remote" = "$files_local" ] ||
    fail "в бакете $files_name.enc размером ${files_remote:-0} байт, а должно быть $files_local"
  say "ГОТОВО: файлы $files_name → s3://$S3_BUCKET/$files_key ($(human_size "$files_local"), файлов: $files_count)"
fi

# Правило жизненного цикла срабатывает раз в сутки, не мгновенно, — три дня запаса.
# Лишние копии — это персональные данные дольше обещанного срока (docs/PRIVACY.md).
cutoff=$(days_ago $((KEEP_DAYS + 3)))
uploads_all=$(list_uploads) || uploads_all=""
stale=$(printf '%s\n%s\n' "$copies" "$uploads_all" | awk -v c="$cutoff" 'NF && $1 < c' | grep -c . || true)
if [ "$stale" -gt 0 ]; then
  warn "копий старше срока в бакете: $stale (загружены раньше $cutoff) — правило жизненного цикла ($KEEP_DAYS суток, префикс $S3_PREFIX) не настроено или не работает"
  WARNED=1
fi
[ "$WARNED" = 0 ] || exit 2
