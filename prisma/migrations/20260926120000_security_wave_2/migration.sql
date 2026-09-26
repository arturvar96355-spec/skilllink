-- Безопасность, волна 2 (решение 133).
--
-- 1. telegram_updates_seen — обработанные обновления Telegram: повтор update_id после
--    перезапуска процесса не выполняется второй раз (INSERT … ON CONFLICT DO NOTHING).
-- 2. system_secrets — секреты, которые меняются без перезапуска: сейчас только секрет
--    вебхука Telegram после смены администратором. Хранится SHA-256, не значение.
-- 3. approvals — «четыре глаза»: опасную операцию одобряет другой администратор,
--    одобрение одноразовое. Включается APPROVALS_REQUIRED=true.
-- 4. idempotency_keys — ключи идемпотентности POST-созданий (заголовок Idempotency-Key).
-- 5. Согласие контакта: редакция политики, хеш текста согласия, где получено —
--    в contacts и снимком в contact_basis_history. Колонки NULL: у согласий,
--    записанных до миграции, этих сведений нет, задним числом они не выдумываются.
--
-- Откат (выполнить вручную; ключи идемпотентности, одобрения, отметки обновлений
-- и сменённый секрет вебхука теряются — после отката снова действует
-- TELEGRAM_WEBHOOK_SECRET из окружения, setWebhook нужно повторить с ним):
--   DROP TABLE "idempotency_keys"; DROP TABLE "approvals"; DROP TABLE "system_secrets";
--   DROP TABLE "telegram_updates_seen";
--   DROP TYPE "IdempotencyStatus"; DROP TYPE "ApprovalStatus";
--   ALTER TABLE "contacts" DROP CONSTRAINT "contacts_consent_record_check",
--     DROP COLUMN "consent_context", DROP COLUMN "consent_policy_version", DROP COLUMN "consent_text_hash";
--   ALTER TABLE "contact_basis_history" DROP CONSTRAINT "contact_basis_history_consent_text_hash_check",
--     DROP COLUMN "consent_text_hash", DROP COLUMN "policy_version";

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED');

-- AlterTable
ALTER TABLE "contact_basis_history" ADD COLUMN     "consent_text_hash" TEXT,
ADD COLUMN     "policy_version" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "consent_context" TEXT,
ADD COLUMN     "consent_policy_version" TEXT,
ADD COLUMN     "consent_text_hash" TEXT;

-- CreateTable
CREATE TABLE "telegram_updates_seen" (
    "update_id" BIGINT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_updates_seen_pkey" PRIMARY KEY ("update_id")
);

-- CreateTable
CREATE TABLE "system_secrets" (
    "name" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_by_id" TEXT,

    CONSTRAINT "system_secrets_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "rejected_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateIndex
CREATE INDEX "telegram_updates_seen_seen_at_idx" ON "telegram_updates_seen"("seen_at");

-- CreateIndex
CREATE INDEX "system_secrets_rotated_by_id_idx" ON "system_secrets"("rotated_by_id");

-- CreateIndex
CREATE INDEX "approvals_status_expires_at_idx" ON "approvals"("status", "expires_at");

-- CreateIndex
CREATE INDEX "approvals_requested_by_id_idx" ON "approvals"("requested_by_id");

-- CreateIndex
CREATE INDEX "approvals_approved_by_id_idx" ON "approvals"("approved_by_id");

-- CreateIndex
CREATE INDEX "approvals_rejected_by_id_idx" ON "approvals"("rejected_by_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "system_secrets" ADD CONSTRAINT "system_secrets_rotated_by_id_fkey" FOREIGN KEY ("rotated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Ограничения, которых нет в схеме Prisma ───────────────────────────────────

-- Сведения о согласии — только у согласия (получено или отозвано); хеш — hex SHA-256.
-- Строки до миграции: у NONE колонки пустые, у OBTAINED/WITHDRAWN — NULL допустим.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_consent_record_check"
  CHECK (
    ("consent_status" <> 'NONE' OR ("consent_policy_version" IS NULL AND "consent_text_hash" IS NULL AND "consent_context" IS NULL))
    AND ("consent_text_hash" IS NULL OR "consent_text_hash" ~ '^[0-9a-f]{64}$')
    AND ("consent_policy_version" IS NULL OR length("consent_policy_version") BETWEEN 1 AND 50)
    AND ("consent_context" IS NULL OR length("consent_context") BETWEEN 1 AND 200)
  );

ALTER TABLE "contact_basis_history" ADD CONSTRAINT "contact_basis_history_consent_text_hash_check"
  CHECK ("consent_text_hash" IS NULL OR "consent_text_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "system_secrets" ADD CONSTRAINT "system_secrets_value_hash_check"
  CHECK ("value_hash" ~ '^[0-9a-f]{64}$');

-- Одобряет другой администратор; статус согласован с отметками.
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_consistency_check"
  CHECK (
    "payload_hash" ~ '^[0-9a-f]{64}$'
    AND ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id")
    AND ("status" NOT IN ('APPROVED', 'CONSUMED') OR "approved_by_id" IS NOT NULL)
    AND (("status" = 'CONSUMED') = ("consumed_at" IS NOT NULL))
    AND ("status" <> 'REJECTED' OR "rejected_by_id" IS NOT NULL)
    AND "expires_at" > "created_at"
  );

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_consistency_check"
  CHECK (
    length("key") BETWEEN 1 AND 255
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND (("status" = 'SUCCEEDED') = ("response_status" IS NOT NULL))
  );

ALTER TABLE "telegram_updates_seen" ADD CONSTRAINT "telegram_updates_seen_update_id_check"
  CHECK ("update_id" >= 0);
