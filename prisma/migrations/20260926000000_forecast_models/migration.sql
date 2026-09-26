-- Модель прогноза «дойдёт ли связка до вехи» (решение 125, docs/FORECAST_MODEL.md).
--
-- Одна запись на веху (milestone_stage): новое обучение заменяет предыдущую запись той же
-- вехи (уникальность по milestone_stage), версия растёт. Прогнозы для конкретных связок
-- не хранятся — считаются на лету. Таблица не содержит персональных данных: коэффициенты
-- и метрики качества модели (см. src/modules/dsar/dsar.registry.ts, DSAR_NOT_PERSONAL).
--
-- CHECK forecast_models_coefficients_check: coefficients заполнены ровно тогда, когда
-- status = 'PUBLISHED' — модель без коэффициентов не может считаться опубликованной.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; данные обучения теряются
-- безвозвратно, связки и их история не затрагиваются):
--   DROP TABLE "forecast_models";
--   DROP TYPE "ForecastModelStatus";

-- CreateEnum
CREATE TYPE "ForecastModelStatus" AS ENUM ('PUBLISHED', 'BASELINE_BETTER', 'INSUFFICIENT_DATA');

-- CreateTable
CREATE TABLE "forecast_models" (
    "id" TEXT NOT NULL,
    "milestone_stage" INTEGER NOT NULL,
    "horizon_days" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ForecastModelStatus" NOT NULL,
    "trained_at" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "coefficients" JSONB,
    "feature_stats" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecast_models_milestone_stage_key" ON "forecast_models"("milestone_stage");

-- CheckConstraint
ALTER TABLE "forecast_models" ADD CONSTRAINT "forecast_models_coefficients_check"
  CHECK (("status" <> 'PUBLISHED') OR ("coefficients" IS NOT NULL));
