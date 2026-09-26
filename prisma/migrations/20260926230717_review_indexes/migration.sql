-- Индексы по находкам ревью базы (решение 190). Только CREATE INDEX: данные,
-- ограничения и существующие индексы не меняются.
--
-- audit_log(action, created_at) — под GET /api/audit: findAuditEntries
-- (audit.repo.ts) фильтрует по action и сортирует по created_at.
--
-- cooperations(status, created_at) — под countCooperationsOpenAt
-- (analytics.repo.ts): тренд «связки в работе на дату» дашборда фильтрует
-- по status <> PAUSED и created_at <= at.
--
-- universities: индекс по выражению lower(name), а не обычный по name.
-- Поиск при импорте (findUniversitiesByNames/findUniversityRefsByNames,
-- import.repo.ts, решение 190) стал пакетным и идёт через
-- `name: { in: […], mode: 'insensitive' }` — Prisma переводит это в
-- `lower(name) IN (…)`, и индекс по выражению его использует. Обычный
-- B-tree по name такой пользы не даёт: единственный в коде поиск по точному
-- совпадению названия вуза — всегда без учёта регистра, а одиночный
-- `equals + mode: 'insensitive'` Prisma переводит в `name ILIKE $1` без
-- шаблонных символов, и Postgres по такому условию B-tree (обычный или по
-- lower(name)) не использует — проверено `EXPLAIN` на 5000 строк, план
-- остаётся Seq Scan. Точный регистрозависимый поиск по name в коде не
-- встречается нигде — заводить под него индекс не для чего. GIN по
-- gin_trgm_ops (решение 124, поиск дублей) не трогается — он решает другую
-- задачу (кандидаты в дубли оператором `%`), а не точное совпадение.
--
-- Откат (обратима, данные не теряются):
--   DROP INDEX "audit_log_action_created_at_idx";
--   DROP INDEX "cooperations_status_created_at_idx";
--   DROP INDEX "universities_name_lower_idx";
--   и убрать @@index([action, createdAt]) у AuditLog, @@index([status, createdAt])
--   у Cooperation из schema.prisma (комментарий про lower(name) у University
--   не описывает индекс для Prisma — убрать текст комментария).

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "cooperations_status_created_at_idx" ON "cooperations"("status", "created_at");

-- CreateIndex
CREATE INDEX "universities_name_lower_idx" ON "universities" (lower("name"));
