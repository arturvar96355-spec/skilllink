-- Пункт вуза в чек-листе (решение 103, закрывает R-07 в SECURITY_LIMITATIONS.md).
--
-- «Вуз подтвердил получение материалов» (этап 7) — утверждение второй стороны.
-- Сотрудник ИТ-Школы отмечал его сам, и в системе выглядело, что вуз подтвердил.
-- Теперь пункт помечен: при действующем представителе вуза его отмечает только
-- представитель, без представителя сотрудник отмечает с пометкой «чем подтверждено».

ALTER TABLE "tasks"
  ADD COLUMN "is_university_item" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "confirmation_note" TEXT;

-- Существующие связки: признак по номеру этапа и заголовку пункта из конфига
-- (workflow.config.ts, universityItem). Заголовок хранится копией — поэтому по нему.
UPDATE "tasks" t
   SET "is_university_item" = true
  FROM "workflow_stages" s
 WHERE s."id" = t."stage_id"
   AND s."stage_number" = 7
   AND t."title" = 'Вуз подтвердил получение материалов';

-- Уже отмеченные пункты вуза, которые отметил не представитель этого вуза, —
-- честная пометка, что основание не записывалось. Не выдумываем «письмо»:
-- до этой миграции поле не спрашивали. Иначе db:verify на стенде считал бы их
-- нарушением, хотя отметили их по действовавшим тогда правилам.
UPDATE "tasks" t
   SET "confirmation_note" = 'Отмечено сотрудником до решения 103: основание не записывалось'
  FROM "workflow_stages" s
  JOIN "cooperations" c ON c."id" = s."cooperation_id"
 WHERE s."id" = t."stage_id"
   AND t."is_university_item"
   AND t."is_done"
   AND NOT EXISTS (
     SELECT 1 FROM "users" u
      WHERE u."id" = t."done_by_id"
        AND u."role" = 'UNIVERSITY_REP'
        AND u."university_id" = c."university_id"
   );

-- Пометка — только у отмеченного пункта вуза и непустая (3–500 символов, как в API).
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_confirmation_note_check"
    CHECK ("confirmation_note" IS NULL
           OR ("is_done" AND "is_university_item"
               AND char_length(btrim("confirmation_note")) BETWEEN 3 AND 500));

-- Откат (вручную, данных пометок не вернуть — они только в этих колонках):
--   ALTER TABLE "tasks" DROP CONSTRAINT "tasks_confirmation_note_check";
--   ALTER TABLE "tasks" DROP COLUMN "confirmation_note";
--   ALTER TABLE "tasks" DROP COLUMN "is_university_item";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260925210000_task_university_item';
