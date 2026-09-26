-- Письма вузов как обращения (решение 170, вариант 2 ТЗ «Письма вузов»).
--
-- Только новые таблицы — ничего существующего не меняется. `inbound_letters` хранит
-- письмо, его разбор (код + модель или правила) и итог проверки сотрудником;
-- `inbound_letter_tasks` — задание ответственному за вуз, которое создаёт проверка
-- («Верно»/«Неверно»); `inbound_letter_group_stats` — точность разбора по группе
-- с забыванием (тот же принцип, что у обучения рекомендаций, решение 119).
--
-- Отдельная таблица заданий вместо записи в общей ленте рекомендаций — решение
-- описано в docs/TECHNICAL_DECISIONS.md, пункт 170.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; письма, их разбор
-- и задания теряются безвозвратно):
--   DROP TABLE "inbound_letter_group_stats";
--   DROP TABLE "inbound_letter_tasks";
--   DROP TABLE "inbound_letters";
--   DROP TYPE "InboundLetterTaskStatus"; DROP TYPE "InboundLetterVerdict";
--   DROP TYPE "InboundLetterAnalyzedBy"; DROP TYPE "InboundLetterGroup";
--   DROP TYPE "InboundLetterStatus"; DROP TYPE "InboundLetterSource";

-- CreateEnum
CREATE TYPE "InboundLetterSource" AS ENUM ('DEMO', 'EML_UPLOAD');

-- CreateEnum
CREATE TYPE "InboundLetterStatus" AS ENUM ('NEW', 'ANALYZED', 'CONFIRMED', 'CORRECTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "InboundLetterGroup" AS ENUM ('STAGE_SHIFT', 'DOCUMENTS', 'MEETING', 'QUESTION', 'PAUSE_OR_REFUSAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InboundLetterAnalyzedBy" AS ENUM ('MODEL', 'RULES');

-- CreateEnum
CREATE TYPE "InboundLetterVerdict" AS ENUM ('CORRECT', 'INCORRECT');

-- CreateEnum
CREATE TYPE "InboundLetterTaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "inbound_letters" (
    "id" TEXT NOT NULL,
    "sender_email" TEXT NOT NULL,
    "sender_name" TEXT,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "source" "InboundLetterSource" NOT NULL DEFAULT 'DEMO',
    "message_id" TEXT,
    "status" "InboundLetterStatus" NOT NULL DEFAULT 'NEW',
    "university_id" TEXT,
    "cooperation_id" TEXT,
    "stage_number" INTEGER,
    "letter_group" "InboundLetterGroup",
    "letter_action" TEXT,
    "detected_university_id" TEXT,
    "detected_cooperation_id" TEXT,
    "detected_stage_number" INTEGER,
    "detected_group" "InboundLetterGroup",
    "detected_action" TEXT,
    "confidence" DOUBLE PRECISION,
    "quotes" JSONB,
    "analyzed_by" "InboundLetterAnalyzedBy",
    "analyzed_note" TEXT,
    "analyzed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "verdict" "InboundLetterVerdict",
    "review_comment" TEXT,
    "reply_draft" TEXT,
    "reply_draft_source" TEXT,
    "reply_draft_updated_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_letter_tasks" (
    "id" TEXT NOT NULL,
    "letter_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "cooperation_id" TEXT,
    "responsible_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" "InboundLetterGroup" NOT NULL,
    "action" TEXT NOT NULL,
    "status" "InboundLetterTaskStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_letter_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_letter_group_stats" (
    "id" TEXT NOT NULL,
    "group" "InboundLetterGroup" NOT NULL,
    "trials" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "trials_eff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "successes_eff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eff_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_letter_group_stats_pkey" PRIMARY KEY ("id")
);

-- Целостность разбора (решение 170): поля разбора идут все вместе или не идут
-- вовсе — не разбирали, значит, ни группы, ни действия, ни уверенности нет.
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_analysis_group_check"
  CHECK (
    ("analyzed_by" IS NULL) = ("detected_group" IS NULL)
    AND ("analyzed_by" IS NULL) = ("detected_action" IS NULL)
    AND ("analyzed_by" IS NULL) = ("confidence" IS NULL)
    AND ("analyzed_by" IS NULL) = ("analyzed_at" IS NULL)
    AND ("analyzed_by" IS NULL) = ("letter_group" IS NULL)
    AND ("analyzed_by" IS NULL) = ("letter_action" IS NULL)
  );

-- Новое письмо разбора ещё не получило; разобранное, подтверждённое или
-- исправленное — обязано его иметь. Отклонённое как спам — может быть отклонено
-- сразу, без разбора, а может быть отклонено уже после (разбор при этом остаётся).
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_analysis_status_check"
  CHECK (
    ("status" <> 'NEW' OR "analyzed_by" IS NULL)
    AND ("status" NOT IN ('ANALYZED', 'CONFIRMED', 'CORRECTED') OR "analyzed_by" IS NOT NULL)
  );

-- Уверенность разбора — доля 0..1.
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_confidence_range_check"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- Этап — один из 14 (решение 2): NULL, если связка не найдена или ещё на первом контакте.
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_stage_number_range_check"
  CHECK ("stage_number" IS NULL OR ("stage_number" BETWEEN 1 AND 14));
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_detected_stage_number_range_check"
  CHECK ("detected_stage_number" IS NULL OR ("detected_stage_number" BETWEEN 1 AND 14));

-- Проверено — ровно у CONFIRMED/CORRECTED/DISMISSED, и только вместе (кто и когда).
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_reviewed_check"
  CHECK (("status" IN ('CONFIRMED', 'CORRECTED', 'DISMISSED')) = ("reviewed_by_id" IS NOT NULL));
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_reviewed_at_check"
  CHECK (("reviewed_by_id" IS NULL) = ("reviewed_at" IS NULL));

-- Итог проверки соответствует статусу: «Верно» → CONFIRMED, «Неверно» → CORRECTED,
-- у отклонённого спама и у ещё не проверенного письма исхода нет вовсе.
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_verdict_status_check"
  CHECK (
    ("status" = 'CONFIRMED') = ("verdict" IS NOT DISTINCT FROM 'CORRECT')
    AND ("status" = 'CORRECTED') = ("verdict" IS NOT DISTINCT FROM 'INCORRECT')
    AND ("status" IN ('NEW', 'ANALYZED', 'DISMISSED')) = ("verdict" IS NULL)
  );

-- Черновик ответа: текст, источник (`model`/`template`, как у ИИ-помощника) и время
-- правки идут только все вместе.
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_reply_draft_check"
  CHECK (
    ("reply_draft" IS NULL) = ("reply_draft_updated_at" IS NULL)
    AND ("reply_draft" IS NULL) = ("reply_draft_source" IS NULL)
  );
-- Источник — как у ИИ-помощника (`AiDraftSource`, решение 90): конкретная модель,
-- если её написала она, иначе `template` (в том числе у черновика, который
-- сотрудник написал или отредактировал вручную через PATCH).
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_reply_draft_source_check"
  CHECK ("reply_draft_source" IS NULL OR "reply_draft_source" IN ('yandexgpt', 'gigachat', 'template'));

-- Счётчики обучения (решение 170, тот же принцип, что у решения 119): успехов не
-- больше показов, ни то ни другое не отрицательно. Эффективным счётчикам — небольшой
-- запас на округление плавающей точки при затухании.
ALTER TABLE "inbound_letter_group_stats" ADD CONSTRAINT "inbound_letter_group_stats_counts_check"
  CHECK ("trials" >= 0 AND "successes" >= 0 AND "successes" <= "trials");
ALTER TABLE "inbound_letter_group_stats" ADD CONSTRAINT "inbound_letter_group_stats_eff_counts_check"
  CHECK ("trials_eff" >= 0 AND "successes_eff" >= 0 AND "successes_eff" <= "trials_eff" + 0.0001);

-- CreateIndex
CREATE INDEX "inbound_letters_status_idx" ON "inbound_letters"("status");

-- CreateIndex
CREATE INDEX "inbound_letters_university_id_idx" ON "inbound_letters"("university_id");

-- CreateIndex
CREATE INDEX "inbound_letters_cooperation_id_idx" ON "inbound_letters"("cooperation_id");

-- CreateIndex
CREATE INDEX "inbound_letters_received_at_idx" ON "inbound_letters"("received_at");

-- CreateIndex
CREATE INDEX "inbound_letters_reviewed_by_id_idx" ON "inbound_letters"("reviewed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_letter_tasks_letter_id_key" ON "inbound_letter_tasks"("letter_id");

-- CreateIndex
CREATE INDEX "inbound_letter_tasks_university_id_idx" ON "inbound_letter_tasks"("university_id");

-- CreateIndex
CREATE INDEX "inbound_letter_tasks_responsible_id_idx" ON "inbound_letter_tasks"("responsible_id");

-- CreateIndex
CREATE INDEX "inbound_letter_tasks_status_idx" ON "inbound_letter_tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_letter_group_stats_group_key" ON "inbound_letter_group_stats"("group");

-- AddForeignKey
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letters" ADD CONSTRAINT "inbound_letters_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letter_tasks" ADD CONSTRAINT "inbound_letter_tasks_letter_id_fkey" FOREIGN KEY ("letter_id") REFERENCES "inbound_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letter_tasks" ADD CONSTRAINT "inbound_letter_tasks_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letter_tasks" ADD CONSTRAINT "inbound_letter_tasks_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_letter_tasks" ADD CONSTRAINT "inbound_letter_tasks_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
