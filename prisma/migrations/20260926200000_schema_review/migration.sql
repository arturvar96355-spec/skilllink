-- Ревью схемы: таблицы решений 115–139 (решение 143).
--
-- Владелец решил согласовывать схему своими силами вместо внешнего согласования
-- с Тиграном (см. docs/DATABASE_SCHEMA.md, раздел «Ревью схемы 26.09.2026»).
-- Само ревью показало, что миграции 20260925230000–20260926150000 уже сделаны
-- очень аккуратно: первичные и внешние ключи, ON DELETE, индексы по внешним
-- ключам и по полям фильтров, уникальности и большинство CHECK на месте.
-- Здесь — четыре точечные правки, которые ревью всё же нашло:
--
-- 1. recommendation_rule_stats.eff_updated_at был TIMESTAMPTZ(6) — единственная
--    колонка с часовым поясом во всей схеме (миграция 20260926120000_recommendation_learning,
--    решение 119). Остальная схема хранит время как TIMESTAMP(3) и держится на
--    соглашении «приложение всегда пишет UTC» (явно записано в комментарии
--    миграции 20260926000000_audit_hash_chain). Разница экрана не меняет
--    (EXTRACT(EPOCH FROM a - b) даёт то же число при вычитании двух значений
--    одного типа), а несогласованность типа — то, что просит проверить решение 143.
--    Меняем на TIMESTAMP(3), приводя колонку к общему для схемы соглашению;
--    массовый перевод всей схемы на TIMESTAMPTZ — отдельное решение, не в этом ревью.
--    USING … AT TIME ZONE 'UTC' не зависит от TimeZone сеанса, которым бы ни был
--    настроен сервер (на этой машине — Europe/Moscow, не UTC).
--
-- 2. university_merges_undone_check проверял только одну сторону пары
--    (undone_by_id, undone_at): «если есть отменивший — есть и дата», но не
--    наоборот. Делаем проверку симметричной: оба поля или пустые, или оба заданы,
--    как отменяет merge.repo.ts (undoneAt и undoneById — всегда вместе).
--
-- 3. recommendation_signals (решение 136, эксперимент): outcome_at и outcome
--    не были связаны CHECK — по коду (experiment.repo.ts, saveOutcomes) исход
--    пишется в оба поля одним UPDATE или не пишется вовсе, но база это не
--    гарантировала. Добавляем: оба NULL или оба заданы, и исход не раньше
--    самого сигнала.
--
-- 4. approvals (решение 133, «четыре глаза»): decided_at ничем не был связан
--    со статусом. По approvals.repo.ts decided_at ставится ровно при одобрении
--    и отклонении (approve/reject) и остаётся пустым, пока запрос ждёт; consumed
--    наследует decided_at одобрения. Expired — особый случай: просрочиться может
--    и ждущий запрос (decided_at пуст), и одобренный, но не использованный
--    (decided_at уже стоит) — для него правило не сужаем.
--
-- Все четыре правки проверены на демо-данных (npm run db:seed и
-- SEED_DQ_CASES=1 npm run db:seed) — обе версии сида таблиц не трогают
-- (approvals, university_merges — 0 строк; recommendation_signals и
-- recommendation_rule_stats заполняются, ни одна строка не нарушает новые правила).
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную):
--   ALTER TABLE "approvals" DROP CONSTRAINT "approvals_decided_at_check";
--   ALTER TABLE "recommendation_signals" DROP CONSTRAINT "recommendation_signals_outcome_check";
--   ALTER TABLE "university_merges" DROP CONSTRAINT "university_merges_undone_check",
--     ADD CONSTRAINT "university_merges_undone_check"
--       CHECK ("undone_by_id" IS NULL OR "undone_at" IS NOT NULL);
--   ALTER TABLE "recommendation_rule_stats" ALTER COLUMN "eff_updated_at" TYPE TIMESTAMPTZ(6)
--     USING ("eff_updated_at" AT TIME ZONE 'UTC');

-- 1. Тип колонки — как у всей остальной схемы.
ALTER TABLE "recommendation_rule_stats"
  ALTER COLUMN "eff_updated_at" TYPE TIMESTAMP(3) USING ("eff_updated_at" AT TIME ZONE 'UTC');

-- 2. Симметричная проверка отмены слияния.
ALTER TABLE "university_merges" DROP CONSTRAINT "university_merges_undone_check";
ALTER TABLE "university_merges" ADD CONSTRAINT "university_merges_undone_check"
  CHECK (("undone_by_id" IS NULL) = ("undone_at" IS NULL));

-- 3. Исход сигнала — оба поля вместе, не раньше срабатывания.
ALTER TABLE "recommendation_signals" ADD CONSTRAINT "recommendation_signals_outcome_check"
  CHECK (("outcome_at" IS NULL) = ("outcome" IS NULL)
         AND ("outcome_at" IS NULL OR "outcome_at" >= "fired_at"));

-- 4. Дата решения согласована со статусом одобрения.
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_at_check"
  CHECK (
    ("status" = 'REQUESTED' AND "decided_at" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED', 'CONSUMED') AND "decided_at" IS NOT NULL)
    OR "status" = 'EXPIRED'
  );
