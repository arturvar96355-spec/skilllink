-- Учётные записи экспертов хакатона (решение 147).
--
-- `is_reviewer` — эксперт: доступ к серверу без права ломать демонстрационные данные.
-- Проверка — в коде (`shared/auth/permissions.ts`, `assertCan`), не CHECK базы: правило
-- «что необратимо» зависит от маршрута, а не от одной колонки. NOT NULL DEFAULT false —
-- существующие пользователи и вход через демо-cookie не меняются.
ALTER TABLE "users" ADD COLUMN "is_reviewer" BOOLEAN NOT NULL DEFAULT false;
