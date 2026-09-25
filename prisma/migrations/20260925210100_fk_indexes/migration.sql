-- Индексы на внешние ключи, у которых индекса не было (решение 104,
-- DATABASE_SCHEMA.md, раздел «Индексы на внешние ключи»). Только CREATE INDEX:
-- данные и ограничения не меняются.
--
-- Зачем: при удалении или смене id строки, на которую ссылаются, PostgreSQL
-- проверяет ссылающуюся таблицу (RESTRICT / SET NULL / CASCADE). Без индекса это
-- полный просмотр таблицы на каждую удаляемую строку. Плюс фильтры списков
-- документов и встреч по программе (documents.repo, meetings.repo).
--
-- Обычный CREATE INDEX (не CONCURRENTLY): prisma migrate выполняет миграцию
-- в транзакции, а таблицы на объёме MVP строятся за доли секунды.
--
-- Откат (обратима, данные не теряются):
--   DROP INDEX "applications_created_by_id_idx", "document_history_changed_by_id_idx",
--     "documents_program_id_idx", "documents_author_id_idx", "documents_responsible_id_idx",
--     "market_demand_data_source_id_idx", "meeting_participants_user_id_idx",
--     "meeting_participants_contact_id_idx", "meetings_program_id_idx",
--     "meetings_responsible_id_idx", "recommendations_resolved_by_id_idx",
--     "stage_history_changed_by_id_idx", "tasks_done_by_id_idx",
--     "workflow_stages_completed_by_id_idx";
--   и убрать эти @@index из schema.prisma.

-- CreateIndex
CREATE INDEX "applications_created_by_id_idx" ON "applications"("created_by_id");

-- CreateIndex
CREATE INDEX "document_history_changed_by_id_idx" ON "document_history"("changed_by_id");

-- CreateIndex
CREATE INDEX "documents_program_id_idx" ON "documents"("program_id");

-- CreateIndex
CREATE INDEX "documents_author_id_idx" ON "documents"("author_id");

-- CreateIndex
CREATE INDEX "documents_responsible_id_idx" ON "documents"("responsible_id");

-- CreateIndex
CREATE INDEX "market_demand_data_source_id_idx" ON "market_demand"("data_source_id");

-- CreateIndex
CREATE INDEX "meeting_participants_user_id_idx" ON "meeting_participants"("user_id");

-- CreateIndex
CREATE INDEX "meeting_participants_contact_id_idx" ON "meeting_participants"("contact_id");

-- CreateIndex
CREATE INDEX "meetings_program_id_idx" ON "meetings"("program_id");

-- CreateIndex
CREATE INDEX "meetings_responsible_id_idx" ON "meetings"("responsible_id");

-- CreateIndex
CREATE INDEX "recommendations_resolved_by_id_idx" ON "recommendations"("resolved_by_id");

-- CreateIndex
CREATE INDEX "stage_history_changed_by_id_idx" ON "stage_history"("changed_by_id");

-- CreateIndex
CREATE INDEX "tasks_done_by_id_idx" ON "tasks"("done_by_id");

-- CreateIndex
CREATE INDEX "workflow_stages_completed_by_id_idx" ON "workflow_stages"("completed_by_id");
