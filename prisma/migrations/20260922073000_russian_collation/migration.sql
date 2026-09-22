-- Русская сортировка для колонок, по которым API сортирует списки.
--
-- Порядок строк по умолчанию берётся из локали, с которой создан кластер
-- PostgreSQL, и он разный на разных машинах:
--   * macOS (brew): en_US.UTF-8 для кириллицы фактически не работает — реестр
--     из шести вузов выходил в порядке «Уральский, Донской, Новосибирский…»;
--   * образ postgres:16-alpine (CI, docker compose): сравнение по кодам
--     символов — «Ёлкин» раньше «Абв», все строчные после всех заглавных.
--
-- Явная ICU-сортировка на колонке даёт один и тот же правильный порядок везде:
-- у разработчика, в CI, в контейнере и в облаке — независимо от того, как
-- создан кластер. ICU входит в стандартные сборки PostgreSQL 16.
--
-- "ru-x-icu" — детерминированная сортировка: равенство строк по-прежнему
-- побайтовое, поэтому уникальность названий (skills, it_products,
-- data_sources) и поиск без учёта регистра работают как раньше.
-- Уникальные индексы на этих колонках PostgreSQL перестраивает сам.

ALTER TABLE "universities"
  ALTER COLUMN "name"   TYPE TEXT COLLATE "ru-x-icu",
  ALTER COLUMN "city"   TYPE TEXT COLLATE "ru-x-icu",
  ALTER COLUMN "region" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "educational_programs"
  ALTER COLUMN "name" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "it_products"
  ALTER COLUMN "name"     TYPE TEXT COLLATE "ru-x-icu",
  ALTER COLUMN "category" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "skills"
  ALTER COLUMN "name"     TYPE TEXT COLLATE "ru-x-icu",
  ALTER COLUMN "category" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "documents"
  ALTER COLUMN "title" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "contacts"
  ALTER COLUMN "full_name" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "users"
  ALTER COLUMN "full_name" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "data_sources"
  ALTER COLUMN "name" TYPE TEXT COLLATE "ru-x-icu";
