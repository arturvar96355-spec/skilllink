-- Правки по итогам разбора схемы Тиграном.

-- ─── 1. Регион входит в уникальность рыночных данных ────────────────────────
--
-- Было: UNIQUE (skill_id, period, source) — без региона. Второй замер того же
-- навыка за тот же период по другому региону не записывался вовсе.
--
-- Регион одновременно становится обязательным: в PostgreSQL NULL-ы в уникальном
-- ключе считаются различными, и два замера «по стране» без региона перестали бы
-- схлопываться — уникальность потеряла бы смысл ровно там, где нужна.
-- Федеральный уровень — это значение региона, а не его отсутствие.

-- Подстановка до NOT NULL: миграция не должна падать на чужих данных.
UPDATE "market_demand" SET "region" = 'Россия' WHERE "region" IS NULL;

DROP INDEX "market_demand_skill_id_period_source_key";

ALTER TABLE "market_demand" ALTER COLUMN "region" SET NOT NULL,
ALTER COLUMN "region" SET DEFAULT 'Россия';

CREATE UNIQUE INDEX "market_demand_skill_id_period_source_region_key"
  ON "market_demand"("skill_id", "period", "source", "region");

-- ─── 2. Основной контакт — один на вуз ──────────────────────────────────────
--
-- Условие `WHERE is_primary` в схеме Prisma не выражается, поэтому индекс
-- создаётся здесь вручную. Приложение единственность не обеспечивало: карточка
-- вуза брала первый найденный основной контакт и при двух показывала произвольный.
--
-- Если в чужой базе уже есть вуз с двумя основными контактами, создание индекса
-- упадёт. Это осознанно: молча выбрать «главного из двух главных» нельзя,
-- данные должен разобрать человек. Найти такие вузы:
--   SELECT university_id FROM contacts WHERE is_primary
--   GROUP BY university_id HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX "contacts_one_primary_per_university"
  ON "contacts"("university_id") WHERE "is_primary";

-- ─── 3. Индексы под реальные запросы ────────────────────────────────────────
--
-- Поиск рекомендаций по объекту шёл последовательным чтением: ведущая колонка
-- существующего уникального ключа — rule_key, и без неё он не применялся.
CREATE INDEX "recommendations_object_type_object_id_idx"
  ON "recommendations"("object_type", "object_id");

CREATE INDEX "recommendations_cooperation_id_idx"
  ON "recommendations"("cooperation_id");

CREATE INDEX "workflow_stages_responsible_id_idx"
  ON "workflow_stages"("responsible_id");
