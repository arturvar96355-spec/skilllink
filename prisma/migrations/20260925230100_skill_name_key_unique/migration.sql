-- Уникальность названия навыка без учёта регистра и пробелов (решение 110).
--
-- «Machine Learning», «machine learning», «MachineLearning» и «ML Ops» / «MLOps» —
-- один навык. Раньше правило держал только код (skillNameKey в
-- src/modules/skills/skills.rules.ts) под рекомендательной блокировкой (решение 107);
-- теперь его держит база — в том числе от записи в обход сервиса.
--
-- Выражение повторяет skillNameKey шаг в шаг, в том же порядке:
--   JS:  name.normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/gu, '')
--   SQL: normalize → lower (ICU, русская локаль) → убрать пробельные знаки.
-- Почему не lower(regexp_replace(normalize(name, NFKC), '\s', '', 'g')):
--   * порядок: lower до удаления пробелов. Греческая «\u03a3» в конце слова
--     строчится в «\u03c2» только пока пробел на месте — иначе «\u038c\u03a3\u039f\u03a3 \u0391\u03a3» дал бы
--     в базе и в коде разные ключи;
--   * набор пробельных знаков: `\s` в PostgreSQL зависит от сортировки
--     (с ICU он ловит U+0085 и U+001C–U+001F, но не U+FEFF), а в JS `\s` — это
--     ровно список ниже. Список выписан явно — совпадает с кодом при любой сортировке;
--   * COLLATE "ru-x-icu" явно: lower() по ICU, как toLocaleLowerCase('ru'),
--     даже если колонке когда-нибудь сменят сортировку. С сортировкой "C"
--     кириллица не строчилась бы вовсе.
-- Сверка на наборе примеров — тест skills.test.ts («ключ базы совпадает с кодом»)
-- и шаги пробника.
--
-- Prisma индексы по выражению не описывает: в schema.prisma у модели Skill
-- оставлен комментарий, `prisma migrate diff` этот индекс не видит и удалить
-- его не предлагает (проверено, решение 110).
--
-- Если в базе уже есть дубли, миграция падает с их списком, ничего не меняя:
-- какой из двух навыков оставить, решает человек. Разобрать: объединить дубль
-- (POST /api/skills/:id/merge) или переименовать, затем
--   npx prisma migrate resolve --rolled-back 20260925230100_skill_name_key_unique
--   npx prisma migrate deploy
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; код до решения 110
-- работает и без индекса):
--   DROP INDEX "skills_name_key_ci";

DO $$
DECLARE
  duplicates TEXT;
BEGIN
  SELECT string_agg(names, '; ')
    INTO duplicates
    FROM (
      SELECT string_agg('«' || "name" || '»', ', ' ORDER BY "name") AS names
        FROM "skills"
       GROUP BY regexp_replace(
                  lower(normalize("name", NFKC) COLLATE "ru-x-icu"),
                  '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]',
                  '', 'g')
      HAVING count(*) > 1
       LIMIT 20
    ) AS clashes;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'В справочнике навыков есть названия, совпадающие без учёта регистра и пробелов: %', duplicates
      USING HINT = 'Объедините дубли (POST /api/skills/:id/merge) или переименуйте их и повторите миграцию — порядок в начале файла миграции 20260925230100_skill_name_key_unique.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "skills_name_key_ci" ON "skills" (
  (regexp_replace(
     lower(normalize("name", NFKC) COLLATE "ru-x-icu"),
     '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]',
     '', 'g'))
);
