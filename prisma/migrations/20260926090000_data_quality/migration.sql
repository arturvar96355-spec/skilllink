-- Качество данных: поиск дублей, слияние вузов, ИНН и ОГРН (решение 134).
--
-- 1. Расширение pg_trgm — триграммы для нечёткого поиска дублей. Оно в contrib
--    и есть в образе postgres:16-alpine и в Homebrew postgresql@16. С PostgreSQL 13
--    оно «доверенное» (trusted): создать его может владелец базы без прав
--    суперпользователя. Миграции применяет владелец (сервис migrate, POSTGRES_USER),
--    роли приложения skilllink_app право CREATE не нужно: функции и операторы
--    расширения доступны PUBLIC, create-app-role.sql их не отзывает.
--    Сравнение и оценку пар всё равно считает приложение (src/modules/data-quality):
--    база только отбирает кандидатов оператором `%` на больших справочниках.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "universities" ADD COLUMN     "inn" TEXT,
ADD COLUMN     "merged_into_id" TEXT,
ADD COLUMN     "ogrn" TEXT;

-- CreateTable
CREATE TABLE "duplicate_dismissals" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "first_id" TEXT NOT NULL,
    "second_id" TEXT NOT NULL,
    "comment" TEXT,
    "dismissed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_merges" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "merged_by_id" TEXT NOT NULL,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undo_until" TIMESTAMP(3) NOT NULL,
    "field_rules" JSONB NOT NULL,
    "survivorship" JSONB NOT NULL,
    "moved" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "undone_at" TIMESTAMP(3),
    "undone_by_id" TEXT,

    CONSTRAINT "university_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_dismissals_dismissed_by_id_idx" ON "duplicate_dismissals"("dismissed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_dismissals_entity_first_id_second_id_key" ON "duplicate_dismissals"("entity", "first_id", "second_id");

-- CreateIndex
CREATE INDEX "university_merges_source_id_idx" ON "university_merges"("source_id");

-- CreateIndex
CREATE INDEX "university_merges_target_id_idx" ON "university_merges"("target_id");

-- CreateIndex
CREATE INDEX "university_merges_merged_by_id_idx" ON "university_merges"("merged_by_id");

-- CreateIndex
CREATE INDEX "university_merges_undone_by_id_idx" ON "university_merges"("undone_by_id");

-- CreateIndex
CREATE INDEX "educational_programs_name_trgm" ON "educational_programs" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "it_products_name_trgm" ON "it_products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "skills_name_trgm" ON "skills" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "universities_merged_into_id_idx" ON "universities"("merged_into_id");

-- CreateIndex
CREATE INDEX "universities_inn_idx" ON "universities"("inn");

-- CreateIndex
CREATE INDEX "universities_name_trgm" ON "universities" USING GIN ("name" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "universities" ADD CONSTRAINT "universities_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_merges" ADD CONSTRAINT "university_merges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_merges" ADD CONSTRAINT "university_merges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_merges" ADD CONSTRAINT "university_merges_merged_by_id_fkey" FOREIGN KEY ("merged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_merges" ADD CONSTRAINT "university_merges_undone_by_id_fkey" FOREIGN KEY ("undone_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 2. Ограничения, которых Prisma не выражает (schema-constraints.test.ts их сторожит).
-- ИНН организации — ровно 10 цифр, ОГРН — 13. Контрольную цифру проверяет схема ввода
-- (src/shared/validation/inn-ogrn.ts): в CHECK она была бы нечитаемой.
ALTER TABLE "universities"
  ADD CONSTRAINT "universities_inn_check" CHECK ("inn" IS NULL OR "inn" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "universities_ogrn_check" CHECK ("ogrn" IS NULL OR "ogrn" ~ '^[0-9]{13}$'),
  ADD CONSTRAINT "universities_merged_into_check"
    CHECK ("merged_into_id" IS NULL OR ("merged_into_id" <> "id" AND "archived_at" IS NOT NULL));

ALTER TABLE "duplicate_dismissals"
  ADD CONSTRAINT "duplicate_dismissals_entity_check"
    CHECK ("entity" IN ('university', 'skill', 'program', 'product')),
  -- Порядок по кодам символов (COLLATE "C"), как сравнение строк в JavaScript:
  -- иначе порядок пары зависел бы от локали кластера.
  ADD CONSTRAINT "duplicate_dismissals_order_check" CHECK ("first_id" < "second_id" COLLATE "C");

ALTER TABLE "university_merges"
  ADD CONSTRAINT "university_merges_distinct_check" CHECK ("source_id" <> "target_id"),
  ADD CONSTRAINT "university_merges_undone_check" CHECK ("undone_by_id" IS NULL OR "undone_at" IS NOT NULL);
