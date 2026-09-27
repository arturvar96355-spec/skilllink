-- Поручения сотрудникам (решение 207): руководитель или администратор даёт конкретное
-- дело по вузу или связке — «Позвонить в МТУСИ до пятницы».
--
-- Только добавление: новая таблица `assignments` и два перечисления. Существующие
-- таблицы не меняются (связи в schema.prisma у users, universities и cooperations —
-- только обратные поля Prisma, столбцов в них не добавляется).
--
-- Права роли приложения (deploy/yandex-cloud/create-app-role.sql) новой таблице
-- выдаются сами: ALTER DEFAULT PRIVILEGES владельца миграций даёт SELECT, INSERT,
-- UPDATE, DELETE — ровно то, что нужно. Перезапускать скрипт после этой миграции
-- не нужно (он нужен, только когда новой таблице права надо сузить).
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; поручения теряются):
--   DROP TABLE "assignments";
--   DROP TYPE "AssignmentStatus"; DROP TYPE "AssignmentPriority";
-- CreateEnum
CREATE TYPE "AssignmentPriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "university_id" TEXT,
    "cooperation_id" TEXT,
    "due_at" DATE NOT NULL,
    "priority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NEW',
    "done_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_assignee_id_status_idx" ON "assignments"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "assignments_due_at_idx" ON "assignments"("due_at");

-- CreateIndex
CREATE INDEX "assignments_author_id_idx" ON "assignments"("author_id");

-- CreateIndex
CREATE INDEX "assignments_university_id_idx" ON "assignments"("university_id");

-- CreateIndex
CREATE INDEX "assignments_cooperation_id_idx" ON "assignments"("cooperation_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Текст поручения — 1–300 символов без краевых пробелов: сервис обрезает пробелы
-- и отклоняет пустой текст раньше базы, ограничение — вторая линия.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_text_check"
  CHECK ("text" = btrim("text") AND char_length("text") BETWEEN 1 AND 300);

-- Дата выполнения — ровно у сделанного поручения: вернули в работу — дата снимается.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_done_at_check"
  CHECK (("status" = 'DONE') = ("done_at" IS NOT NULL));
