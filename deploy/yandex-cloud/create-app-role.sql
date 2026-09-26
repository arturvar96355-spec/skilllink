-- Роль базы для приложения SkillLink — без прав суперпользователя (аудит S-15).
--
-- Сейчас приложение ходит в базу ролью POSTGRES_USER, которую образ postgres
-- создаёт суперпользователем. Ошибка или внедрение в коде приложения тогда может
-- всё: читать файлы сервера (COPY ... FROM), менять роли, удалять журнал действий.
-- Роль skilllink_app может только работать с данными таблиц схемы public:
--
--   * SELECT, INSERT, UPDATE, DELETE на таблицы; USAGE, SELECT на последовательности;
--   * журнал действий (audit_log) — только читать и дописывать: изменить или удалить
--     запись приложение не может. Срок хранения журнала применяет владелец
--     (npm run db:retention через сервис migrate);
--   * история оснований обработки ПД контактов (contact_basis_history, решение 111) —
--     так же: только читать и дописывать;
--   * печати журнала (audit_seals, решение 115) — только читать и дописывать: печать
--     снимает приложение; точки чистки журнала (audit_chain_cuts) — только читать:
--     их пишет чистка по сроку, а она идёт ролью-владельцем;
--   * реестр запросов субъектов ПД (dsar_requests, решение 116) — читать, дописывать
--     и закрывать запрос (UPDATE статуса; прочие колонки сторожит триггер), без DELETE;
--   * таблица миграций — только чтение;
--   * без TRUNCATE, без создания объектов, без суперпользователя, CREATEDB,
--     CREATEROLE, REPLICATION, BYPASSRLS.
--
-- Миграции по-прежнему применяет владелец (сервис migrate). Таблицы, которые
-- появятся в новых миграциях, получат права автоматически (ALTER DEFAULT PRIVILEGES).
--
-- Выполняет владелец сервера вручную — порядок, проверка и откат в docs/DEPLOY.md,
-- раздел «Роль базы для приложения». Скрипт можно запускать повторно: он приводит
-- роль и права к описанному здесь состоянию.
--
-- Пароль передаётся переменной окружения APP_DB_PASSWORD (psql читает её сам)
-- или параметром -v app_password=... — второй способ оставляет пароль в истории
-- команд. Пароль — только из [0-9a-f]: он встаёт в строку подключения.
--
--   docker compose -p skilllink exec -T -e APP_DB_PASSWORD postgres \
--     psql -U skilllink -d skilllink < deploy/yandex-cloud/create-app-role.sql
--
-- Параметры psql (-v имя=значение), все необязательные, кроме пароля:
--   app_role      имя роли приложения, по умолчанию skilllink_app
--   owner         владелец таблиц (кто применяет миграции), по умолчанию текущий пользователь

\set ON_ERROR_STOP on

\if :{?app_role}
\else
  \set app_role skilllink_app
\endif

\if :{?app_password}
\else
  \getenv app_password APP_DB_PASSWORD
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'Не задан пароль роли приложения: переменная окружения APP_DB_PASSWORD или -v app_password=...'; END $$;
\endif

\if :{?owner}
\else
  SELECT current_user AS owner \gset
\endif

SELECT current_database() AS db \gset

BEGIN;

-- 1. Роль: вход по паролю и ничего сверх этого.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') AS need_role \gset
\if :need_role
  CREATE ROLE :"app_role" LOGIN;
\endif
ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT 30 PASSWORD :'app_password';

-- 2. База: подключаться может только тот, кому разрешено явно.
REVOKE CONNECT, TEMPORARY ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_role";

-- 3. Схема public: пользоваться можно, создавать в ней объекты — нет.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";

-- 4. Данные таблиц. Сначала всё снимается — повторный запуск не оставит лишнего.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- 5. Журнал действий: только читать и дописывать.
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM :"app_role";

-- 5а. История оснований обработки ПД — как журнал: только читать и дописывать.
-- Таблица появляется миграцией 20260925230200: на базе до неё шаг пропускается,
-- а после выкладки скрипт запускается повторно (DEPLOY.md).
SELECT to_regclass('public.contact_basis_history') IS NOT NULL AS has_basis_history \gset
\if :has_basis_history
REVOKE UPDATE, DELETE ON TABLE public.contact_basis_history FROM :"app_role";
\endif

-- 5б. Цепочка журнала (решение 115): печати только дописываются, точки чистки —
-- только читаются. Сверх прав — триггеры запрета правки в самой базе, а чистку журнала
-- (audit_purge_before) роли приложения не вызвать: EXECUTE снят миграцией.
-- Таблицы появляются миграцией 20260926000000; до неё шаг пропускается.
SELECT to_regclass('public.audit_seals') IS NOT NULL AS has_audit_chain \gset
\if :has_audit_chain
REVOKE UPDATE, DELETE ON TABLE public.audit_seals FROM :"app_role";
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_chain_cuts FROM :"app_role";
\endif

-- 5в. Реестр запросов субъектов ПД: без удаления. Неизменяемые колонки держит триггер
-- dsar_requests_guard (миграция 20260926011600); на базе до неё шаг пропускается.
SELECT to_regclass('public.dsar_requests') IS NOT NULL AS has_dsar_requests \gset
\if :has_dsar_requests
REVOKE DELETE ON TABLE public.dsar_requests FROM :"app_role";
\endif

-- 6. Таблица миграций Prisma: только чтение.
REVOKE INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations FROM :"app_role";

-- 7. Таблицы и последовательности из будущих миграций владельца.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

COMMIT;

-- Итог — чтобы глазами сверить с описанием выше.
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit
  FROM pg_roles WHERE rolname = :'app_role';
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE grantee = :'app_role' AND table_name IN ('audit_log', 'contact_basis_history', 'audit_seals', 'audit_chain_cuts', 'dsar_requests', '_prisma_migrations', 'users')
 GROUP BY table_name ORDER BY table_name;
