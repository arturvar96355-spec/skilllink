-- Решение 142: админка бота Telegram — токен и режим приёма хранятся в базе,
-- главнее переменных окружения. Токен шифруется (AES-256-GCM), а не хешируется,
-- как секрет вебхука: приложению нужно само значение, чтобы звать Bot API.
--
-- system_secrets до сих пор хранила только SHA-256 (value_hash NOT NULL, решение 133).
-- Теперь запись бывает двух видов: только хеш (секрет вебхука) или только
-- значение (токен бота — зашифрованный, имя бота и режим приёма — как есть,
-- это не секреты). CHECK гарантирует, что заполнено ровно одно из двух полей,
-- и что value_hash, если он есть, — 64 шестнадцатеричных знака, как раньше.

ALTER TABLE "system_secrets" ALTER COLUMN "value_hash" DROP NOT NULL;
ALTER TABLE "system_secrets" ADD COLUMN "value" TEXT;

ALTER TABLE "system_secrets" DROP CONSTRAINT "system_secrets_value_hash_check";
ALTER TABLE "system_secrets" ADD CONSTRAINT "system_secrets_value_shape_check"
  CHECK (
    ("value_hash" IS NOT NULL AND "value_hash" ~ '^[0-9a-f]{64}$' AND "value" IS NULL)
    OR ("value" IS NOT NULL AND "value_hash" IS NULL)
  );
