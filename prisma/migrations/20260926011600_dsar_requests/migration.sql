-- Реестр запросов субъектов ПД (решение 116, ст. 14 и 20 152-ФЗ).
--
-- Строка — один запрос: о ком (пользователь или контакт вуза), что просит
-- (сведения или уничтожение), кто зарегистрировал, когда, срок ответа, когда
-- исполнено и итог в счётчиках. ПД в строке нет, кроме идентификаторов и адреса
-- клиента у запроса из личного кабинета.
--
-- Запросы не удаляются и не переписываются: приложение добавляет строку и закрывает
-- её. Держат это CHECK (закрыт ровно с датой исполнения, сроки по порядку), триггер
-- dsar_requests_guard (менять можно только статус, дату исполнения, итог и стереть
-- адрес) и роль приложения без DELETE (deploy/yandex-cloud/create-app-role.sql).
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную, реестр запросов теряется):
--   DROP TABLE "dsar_requests";
--   DROP FUNCTION "dsar_requests_guard"();
--   DROP TYPE "DsarRequestChannel"; DROP TYPE "DsarRequestStatus";
--   DROP TYPE "DsarRequestKind"; DROP TYPE "DsarSubjectType";

-- CreateEnum
CREATE TYPE "DsarSubjectType" AS ENUM ('USER', 'CONTACT');

-- CreateEnum
CREATE TYPE "DsarRequestKind" AS ENUM ('EXPORT', 'ERASE');

-- CreateEnum
CREATE TYPE "DsarRequestStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DsarRequestChannel" AS ENUM ('SELF_SERVICE', 'LETTER', 'ADMIN');

-- CreateTable
CREATE TABLE "dsar_requests" (
    "id" TEXT NOT NULL,
    "subject_type" "DsarSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "kind" "DsarRequestKind" NOT NULL,
    "channel" "DsarRequestChannel" NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" "DsarRequestStatus" NOT NULL DEFAULT 'OPEN',
    "summary" JSONB,
    "ip" TEXT,

    CONSTRAINT "dsar_requests_pkey" PRIMARY KEY ("id"),
    -- Исполненный запрос — ровно с датой исполнения.
    CONSTRAINT "dsar_requests_completed_check" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
    -- Срок ответа — позже запроса; исполнение — не раньше запроса.
    CONSTRAINT "dsar_requests_due_check" CHECK ("due_at" > "requested_at"),
    CONSTRAINT "dsar_requests_completed_after_check" CHECK ("completed_at" IS NULL OR "completed_at" >= "requested_at"),
    -- Адрес клиента — короткая строка, а не произвольный текст.
    CONSTRAINT "dsar_requests_ip_check" CHECK ("ip" IS NULL OR length("ip") <= 64)
);

-- CreateIndex
CREATE INDEX "dsar_requests_subject_type_subject_id_requested_at_idx" ON "dsar_requests"("subject_type", "subject_id", "requested_at");

-- CreateIndex
CREATE INDEX "dsar_requests_status_due_at_idx" ON "dsar_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "dsar_requests_requested_by_id_idx" ON "dsar_requests"("requested_by_id");

-- AddForeignKey
ALTER TABLE "dsar_requests" ADD CONSTRAINT "dsar_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Запрос нельзя переписать задним числом: кто, о ком, что, когда и срок — неизменны.
-- Меняются только статус, дата исполнения, итог; адрес клиента можно только стереть.
-- Закрытый запрос не открывается снова.
CREATE FUNCTION "dsar_requests_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."subject_type" IS DISTINCT FROM OLD."subject_type"
     OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."channel" IS DISTINCT FROM OLD."channel"
     OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
     OR NEW."due_at" IS DISTINCT FROM OLD."due_at"
     OR (NEW."ip" IS DISTINCT FROM OLD."ip" AND NEW."ip" IS NOT NULL)
     OR (OLD."status" = 'COMPLETED' AND (NEW."status" <> 'COMPLETED' OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at")) THEN
    RAISE EXCEPTION 'dsar_requests: запрос субъекта нельзя переписать — только закрыть' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dsar_requests_guard"
  BEFORE UPDATE ON "dsar_requests"
  FOR EACH ROW EXECUTE FUNCTION "dsar_requests_guard"();
