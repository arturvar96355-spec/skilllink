-- Учёт правового основания обработки ПД контактных лиц вузов и согласий (решение 111).
--
-- У контакта — текущее основание (ч. 1 ст. 6 152-ФЗ), статус согласия, дата и форма
-- согласия, дата отзыва, где лежат документ-основание и документ отзыва. Существующие
-- контакты получают основание NULL («не зафиксировано») и статус NONE: задним числом
-- основание не выдумывается, его фиксирует сотрудник по документам.
--
-- История — отдельная таблица: кто, когда, что было → что стало. Только коды, даты
-- и признаки; комментария и текста документа-основания в ней нет (история переживает
-- обезличивание контакта и служит выгрузкой для акта уничтожения).
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; учёт оснований и его
-- история теряются безвозвратно, сами контакты не затрагиваются):
--   DROP TABLE "contact_basis_history";
--   ALTER TABLE "contacts"
--     DROP CONSTRAINT "contacts_consent_status_check",
--     DROP CONSTRAINT "contacts_consent_details_check",
--     DROP CONSTRAINT "contacts_consent_withdrawal_check",
--     DROP CONSTRAINT "contacts_basis_reference_check",
--     DROP COLUMN "legal_basis", DROP COLUMN "consent_status",
--     DROP COLUMN "consent_obtained_at", DROP COLUMN "consent_form",
--     DROP COLUMN "consent_withdrawn_at", DROP COLUMN "basis_reference",
--     DROP COLUMN "withdrawal_reference", DROP COLUMN "basis_updated_at";
--   DROP TYPE "ConsentForm"; DROP TYPE "ConsentStatus"; DROP TYPE "ContactLegalBasis";

-- CreateEnum
CREATE TYPE "ContactLegalBasis" AS ENUM ('LEGITIMATE_INTEREST', 'CONTRACT', 'CONSENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('NONE', 'OBTAINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentForm" AS ENUM ('WRITTEN', 'ELECTRONIC', 'ORAL_CONFIRMED_BY_EMAIL');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "basis_reference" TEXT,
ADD COLUMN     "basis_updated_at" TIMESTAMP(3),
ADD COLUMN     "consent_form" "ConsentForm",
ADD COLUMN     "consent_obtained_at" TIMESTAMP(3),
ADD COLUMN     "consent_status" "ConsentStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "consent_withdrawn_at" TIMESTAMP(3),
ADD COLUMN     "legal_basis" "ContactLegalBasis",
ADD COLUMN     "withdrawal_reference" TEXT;

-- Статус согласия не NONE ровно тогда, когда основание — согласие.
-- IS NOT DISTINCT FROM: при NULL-основании сравнение даёт false, а не NULL,
-- и CHECK не пропускает «нет основания, но согласие получено».
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_consent_status_check"
  CHECK (("legal_basis" IS NOT DISTINCT FROM 'CONSENT') = ("consent_status" <> 'NONE'));

-- Дата и форма согласия — ровно у полученного или отозванного согласия.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_consent_details_check"
  CHECK (
    ("consent_status" = 'NONE') = ("consent_obtained_at" IS NULL)
    AND ("consent_status" = 'NONE') = ("consent_form" IS NULL)
  );

-- Дата и документ отзыва — ровно у отозванного согласия; отзыв не раньше получения.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_consent_withdrawal_check"
  CHECK (
    ("consent_status" = 'WITHDRAWN') = ("consent_withdrawn_at" IS NOT NULL)
    AND ("consent_status" = 'WITHDRAWN') = ("withdrawal_reference" IS NOT NULL)
    AND ("consent_withdrawn_at" IS NULL OR "consent_withdrawn_at" >= "consent_obtained_at")
  );

-- Основание без документа не доказать (ч. 3 ст. 9 — доказывает оператор):
-- документ и дата фиксации — ровно при заданном основании.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_basis_reference_check"
  CHECK (
    ("legal_basis" IS NULL) = ("basis_reference" IS NULL)
    AND ("legal_basis" IS NULL) = ("basis_updated_at" IS NULL)
  );

-- CreateTable
CREATE TABLE "contact_basis_history" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "from_basis" "ContactLegalBasis",
    "to_basis" "ContactLegalBasis" NOT NULL,
    "from_consent_status" "ConsentStatus" NOT NULL,
    "to_consent_status" "ConsentStatus" NOT NULL,
    "consent_obtained_at" TIMESTAMP(3),
    "consent_form" "ConsentForm",
    "consent_withdrawn_at" TIMESTAMP(3),
    "reference_changed" BOOLEAN NOT NULL DEFAULT false,
    "anonymized" BOOLEAN NOT NULL DEFAULT false,
    "changed_by_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_basis_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_basis_history_consent_status_check"
      CHECK (("to_basis" = 'CONSENT') = ("to_consent_status" <> 'NONE'))
);

-- История контакта открывается по контакту в порядке времени.
-- CreateIndex
CREATE INDEX "contact_basis_history_contact_id_changed_at_idx" ON "contact_basis_history"("contact_id", "changed_at");

-- CreateIndex
CREATE INDEX "contact_basis_history_changed_by_id_idx" ON "contact_basis_history"("changed_by_id");

-- AddForeignKey
ALTER TABLE "contact_basis_history" ADD CONSTRAINT "contact_basis_history_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_basis_history" ADD CONSTRAINT "contact_basis_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
