-- CHECK-ограничения: правила, которые база держит сама (DATABASE_SCHEMA.md,
-- раздел «CHECK-ограничения»). Приложение проверяет их раньше базы; ограничение —
-- вторая линия на случай записи в обход сервиса. Нарушение API отдаёт как 422
-- с именем ограничения (shared/http/handle.ts).

-- Этапы: номер 1–14; завершённый — с результатом (кроме 14-го, его закрывает
-- система); заблокированный — с причиной.
ALTER TABLE "workflow_stages"
  ADD CONSTRAINT "workflow_stages_stage_number_check"
    CHECK ("stage_number" BETWEEN 1 AND 14),
  ADD CONSTRAINT "workflow_stages_completed_result_check"
    CHECK ("status" <> 'COMPLETED' OR "stage_number" = 14
           OR ("result" IS NOT NULL AND btrim("result") <> '')),
  ADD CONSTRAINT "workflow_stages_blocked_reason_check"
    CHECK ("status" <> 'BLOCKED'
           OR ("blocking_reason" IS NOT NULL AND btrim("blocking_reason") <> ''));

-- Показатели программ: NULL — «нет данных», иначе не меньше нуля.
ALTER TABLE "educational_programs"
  ADD CONSTRAINT "educational_programs_application_count_check"
    CHECK ("application_count" IS NULL OR "application_count" >= 0),
  ADD CONSTRAINT "educational_programs_student_count_check"
    CHECK ("student_count" IS NULL OR "student_count" >= 0),
  ADD CONSTRAINT "educational_programs_group_count_check"
    CHECK ("group_count" IS NULL OR "group_count" >= 0),
  ADD CONSTRAINT "educational_programs_duration_months_check"
    CHECK ("duration_months" IS NULL OR "duration_months" BETWEEN 1 AND 120);

ALTER TABLE "universities"
  ADD CONSTRAINT "universities_student_count_check"
    CHECK ("student_count" IS NULL OR "student_count" >= 0),
  ADD CONSTRAINT "universities_direction_count_check"
    CHECK ("direction_count" IS NULL OR "direction_count" >= 0);

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_quantity_check"
    CHECK ("quantity" BETWEEN 1 AND 10000);

ALTER TABLE "market_demand"
  ADD CONSTRAINT "market_demand_value_check"
    CHECK ("value" >= 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_sort_order_check"
    CHECK ("sort_order" >= 0);
