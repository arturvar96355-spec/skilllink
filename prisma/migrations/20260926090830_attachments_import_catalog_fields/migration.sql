-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('NOT_TRANSFERRED', 'IN_PROGRESS', 'TRANSFERRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttachmentOwnerType" AS ENUM ('DOCUMENT', 'STAGE');

-- AlterTable
ALTER TABLE "cooperations" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "contract_number" TEXT,
ADD COLUMN     "license_signed_at" TIMESTAMP(3),
ADD COLUMN     "license_term_years" INTEGER,
ADD COLUMN     "transfer_status" "TransferStatus";

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "owner_type" "AttachmentOwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_owner_type_owner_id_idx" ON "attachments"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_id_idx" ON "attachments"("uploaded_by_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK-ограничения (решение 145, DATABASE_SCHEMA.md «CHECK-ограничения»): приложение
-- проверяет их раньше базы, ограничение — вторая линия на случай записи в обход сервиса.

-- Файл нулевого размера — не файл, а сбой загрузки; верхний предел (MAX_ATTACHMENT_SIZE_BYTES,
-- src/shared/config/attachments.config.ts) держит приложение, не база: он настраивается
-- переменной окружения без миграции.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_check"
    CHECK ("size" > 0);

-- Каталог по ТЗ: срок действия лицензии в годах — 1..10, как у длительности программы.
ALTER TABLE "cooperations"
  ADD CONSTRAINT "cooperations_license_term_years_check"
    CHECK ("license_term_years" IS NULL OR "license_term_years" BETWEEN 1 AND 10);
