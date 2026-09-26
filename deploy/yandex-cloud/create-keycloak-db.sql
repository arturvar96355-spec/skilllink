-- Отдельная база для Keycloak (ТЗ, функц. 10; решение 188) — в ТОМ ЖЕ контейнере
-- PostgreSQL, что база приложения, но НЕ в ней: у Keycloak свои таблицы (реалмы,
-- клиенты, пользователи IdP), путать их со схемой приложения нельзя.
--
-- На стенде база приложения уже существует с данными — этот скрипт её не трогает
-- и не пересоздаёт том: CREATE DATABASE добавляет вторую базу рядом, в тот же
-- кластер (том skilllink-pgdata). Выполняется один раз, вручную, ДО первого
-- запуска профиля `keycloak`:
--
--   docker compose -p skilllink exec -T postgres \
--     psql -U skilllink -d skilllink < deploy/yandex-cloud/create-keycloak-db.sql
--
-- Параметры (-v ...), оба необязательные:
--   keycloak_db     имя базы Keycloak, по умолчанию keycloak (совпадает с тем,
--                   что читает docker-compose.yml — KEYCLOAK_DB_NAME)
--   keycloak_owner  владелец новой базы, по умолчанию текущая роль подключения
--                   (POSTGRES_USER — та же роль, которой ходит Keycloak, KC_DB_USERNAME)
--
-- CREATE DATABASE нельзя выполнить внутри транзакции — команда идёт отдельно
-- и сначала проверяет, что базы ещё нет: повторный запуск не должен упасть
-- ошибкой «database already exists» и остановить развёртывание.

\set ON_ERROR_STOP on

\if :{?keycloak_db}
\else
  \set keycloak_db keycloak
\endif

\if :{?keycloak_owner}
\else
  SELECT current_user AS keycloak_owner \gset
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'keycloak_db') AS need_db \gset
\if :need_db
  CREATE DATABASE :"keycloak_db" OWNER :"keycloak_owner";
  \echo База :"keycloak_db" создана.
\else
  \echo База :"keycloak_db" уже существует — ничего не делаю (можно запускать повторно).
\endif
