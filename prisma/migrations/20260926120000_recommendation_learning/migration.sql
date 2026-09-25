-- Решение 119: рекомендации учатся на решениях сотрудников и объясняют себя.

-- Балл, его разбор, причины, пометка «отложено» и моменты показа и успеха.
-- Старые записи остаются без показа (shown_at NULL): в статистику правил они
-- не входили и успехом не засчитываются. Балл им проставит первая пересборка.
ALTER TABLE "recommendations" ADD COLUMN     "is_deferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reasons" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION,
ADD COLUMN     "score_breakdown" JSONB,
ADD COLUMN     "shown_at" TIMESTAMP(3),
ADD COLUMN     "success_at" TIMESTAMP(3);

CREATE INDEX "recommendations_score_idx" ON "recommendations"("score");

-- Статистика правил: полные и эффективные (с затуханием) счётчики показов и успехов.
CREATE TABLE "recommendation_rule_stats" (
    "rule_type" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "trials" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "trials_eff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "successes_eff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eff_updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recommendation_rule_stats_pkey" PRIMARY KEY ("rule_type","scope_type","scope_id")
);

-- Prisma не выражает CHECK — ограничения живут здесь (schema-constraints.test.ts).
ALTER TABLE "recommendation_rule_stats"
  ADD CONSTRAINT "recommendation_rule_stats_scope_type_check"
  CHECK ("scope_type" IN ('global', 'university', 'manager'));

-- Успехов не больше показов — и в полных счётчиках, и в эффективных.
-- Запись поддерживает это сама (GREATEST в upsert); ограничение — страховка.
ALTER TABLE "recommendation_rule_stats"
  ADD CONSTRAINT "recommendation_rule_stats_counts_check"
  CHECK ("successes" >= 0 AND "successes" <= "trials"
         AND "successes_eff" >= 0 AND "successes_eff" <= "trials_eff");
