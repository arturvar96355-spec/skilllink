-- Журнал сигналов правил рекомендаций: контрольная группа и оценка прироста (решение 126).
--
-- Каждое срабатывание правила пишется сигналом с группой: treatment — рекомендацию
-- показали, control — придержали для сравнения. Новых данных о людях в таблице нет:
-- правило, объект (связка, программа, навык), время, группа и исход.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; журнал сигналов и
-- посчитанные исходы теряются, сами рекомендации не затрагиваются):
--   DROP TABLE "recommendation_signals";
--   DROP TYPE "ExperimentArm";
-- CreateEnum
CREATE TYPE "ExperimentArm" AS ENUM ('treatment', 'control');

-- CreateTable
CREATE TABLE "recommendation_signals" (
    "id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL,
    "arm" "ExperimentArm" NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "context" JSONB,
    "outcome_at" TIMESTAMP(3),
    "outcome" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_signals_fired_at_idx" ON "recommendation_signals"("fired_at");

-- CreateIndex
CREATE INDEX "recommendation_signals_recommendation_id_idx" ON "recommendation_signals"("recommendation_id");

-- CreateIndex
CREATE INDEX "recommendation_signals_entity_type_entity_id_idx" ON "recommendation_signals"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_signals_rule_type_entity_type_entity_id_peri_key" ON "recommendation_signals"("rule_type", "entity_type", "entity_id", "period_key");

-- AddForeignKey
ALTER TABLE "recommendation_signals" ADD CONSTRAINT "recommendation_signals_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Контроль — только назначенный по хешу и без показанной рекомендации: иначе
-- «контрольная группа» видела бы рекомендацию, и сравнение потеряло бы смысл.
ALTER TABLE "recommendation_signals" ADD CONSTRAINT "recommendation_signals_arm_check"
  CHECK ("arm" = 'treatment' OR ("assigned_by" = 'hash' AND "recommendation_id" IS NULL));

-- Способ назначения — из закрытого списка (experiment/assignment.ts, ASSIGNED_BY).
ALTER TABLE "recommendation_signals" ADD CONSTRAINT "recommendation_signals_assigned_by_check"
  CHECK ("assigned_by" IN ('hash', 'experiment-off', 'excluded-rule', 'already-shown', 'dismissed', 'resolved'));
