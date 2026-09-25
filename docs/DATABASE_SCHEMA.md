# DATABASE_SCHEMA.md — схема базы данных

Источник истины — `prisma/schema.prisma`. Этот документ описывает решения, которые из кода
не видны. Все изменения схемы согласуются с Тиграном.

СУБД: PostgreSQL 16. Доступ — Prisma 7 через драйверный адаптер `@prisma/adapter-pg`.
Миграции: `prisma migrate` (не `db push`), файлы лежат в `prisma/migrations/`.

## Соглашения

- Имена полей в коде — camelCase, в базе — snake_case через `@map`; имена таблиц — через `@@map`.
- Первичные ключи — `cuid()`, тип `text`.
- Везде есть `created_at` и `updated_at`.
- Удаления нет: вузы и программы **архивируются** (`archived_at`), история сохраняется.
- `is_mock` отмечает демонстрационные записи. Выдавать их за реальные данные запрещено.
- Числовой показатель, который не заполнен, хранится как **NULL**, а не 0. Ноль — это значение,
  NULL — это «Нет данных».

### CHECK-ограничения

Правило, которое база обязана держать сама (номер этапа 1–14, неотрицательные
показатели), задаётся ограничением с именем `<таблица>_<столбец>_check`
(или `<таблица>_<смысл>_check` для правила на несколько столбцов). Нарушение
API отдаёт как `422 VALIDATION_ERROR` с `details.constraint` — именем ограничения;
текст Postgres с содержимым строки наружу не уходит (`shared/http/handle.ts`).
Приложение проверяет те же правила раньше базы: ограничение — вторая линия,
на случай записи в обход сервиса.

Действующие (миграция `20260924150000_check_constraints`):

| Ограничение | Правило |
| --- | --- |
| `workflow_stages_stage_number_check` | номер этапа 1–14 |
| `workflow_stages_completed_result_check` | завершённый этап — с непустым результатом; этап 14 закрывает система, ему не нужен |
| `workflow_stages_blocked_reason_check` | заблокированный этап — с непустой причиной |
| `educational_programs_{application,student,group}_count_check` | NULL или ≥ 0 |
| `educational_programs_duration_months_check` | NULL или 1–120 |
| `universities_{student,direction}_count_check` | NULL или ≥ 0 |
| `applications_quantity_check` | 1–10000 |
| `market_demand_value_check` | ≥ 0 |
| `tasks_sort_order_check` | ≥ 0 |
| `calendar_feeds_token_hash_check` | 64 шестнадцатеричных знака — хеш, а не сам токен (миграция `20260925210200_calendar_feeds`) |
| `tasks_confirmation_note_check` | пометка — только у отмеченного пункта вуза, 3–500 символов без краевых пробелов (миграция `20260925210000_task_university_item`) |

В `schema.prisma` ограничения не описываются (Prisma их не выражает), только
в `migration.sql`; у модели стоит комментарий. Новое ограничение сначала
проверяется запросом на свежем сиде и на данных стенда: ноль нарушений.

### Проверка целостности — `npm run db:verify`

Правила, которые база одним ограничением не выражает — они про несколько строк
или таблиц, — проверяет `scripts/db-verify.ts`: у связки 14 этапов; у завершённого
этапа закрыты обязательные пункты, есть дата и автор; статус этапа 14 — функция
этапов 1–13 (тот же `computeControlStatus`, что в приложении); последняя запись
истории совпадает со статусом; документ, встреча и заявка относятся к вузу своей
связки и программы; дата закрытия — ровно у закрытых связок и рекомендаций;
рекомендация ссылается на существующий объект; признак «пункт вуза» стоит ровно
у пунктов вуза из конфига, а отмеченный пункт вуза отметил представитель этого вуза
или у него есть пометка «чем подтверждено» (решение 103); выражение индекса
`skills_name_key_ci` считает ключ названия навыка так же, как `skillNameKey` в коде
(решение 110). С `--demo` — ещё пометка `is_mock` у всего демо-набора.

Каждое правило — запрос, который ищет нарушения; всё в транзакции READ ONLY.
Запускается в CI после сида и после сквозного сценария с пробником (записи самого
приложения правил не нарушают) и на стенде при каждой перезаливке (`reseed.sh`).
Новое правило приложения, которое держится на нескольких таблицах, добавляется сюда.

### Индексы на внешние ключи

У каждого внешнего ключа есть индекс, первая колонка которого — колонка ключа
(решение 104, миграция `20260925210100_fk_indexes`). Сам PostgreSQL такой индекс
не создаёт. Без него при удалении строки, на которую ссылаются, проверка ключа
(RESTRICT, SET NULL, CASCADE) читает ссылающуюся таблицу целиком — на каждую
удаляемую строку.

Миграция добавила 14 индексов: `applications.created_by_id`,
`document_history.changed_by_id`, `documents.{program_id, author_id, responsible_id}`,
`market_demand.data_source_id`, `meeting_participants.{user_id, contact_id}`,
`meetings.{program_id, responsible_id}`, `recommendations.resolved_by_id`,
`stage_history.changed_by_id`, `tasks.done_by_id`, `workflow_stages.completed_by_id`.
Имена — по правилу Prisma: `<таблица>_<столбец>_idx`.

Проверка, что ключей без индекса нет (норма — ноль строк):

```sql
SELECT c.conrelid::regclass, a.attname, c.conname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
```

Новый внешний ключ заводится вместе с `@@index` на его колонку.

## Таблицы

### users — пользователи и роли

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | |
| email | text UNIQUE | |
| full_name | text | |
| position | text? | |
| role | UserRole | ADMIN, MANAGER, ANALYST, VIEWER, UNIVERSITY_REP |
| university_id | text? FK → universities | заполнен только у UNIVERSITY_REP |
| password_hash | text? | **не используется на P0**; заложено под NextAuth.js + bcrypt на P1 |
| is_active | boolean | |

Индексы: `role`, `university_id`.

### universities — образовательные организации

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | |
| name, city, region | text | обязательные |
| short_name, address, website, description | text? | |
| status | UniversityStatus | NEW, IN_PROGRESS, ACTIVE, PAUSED, ARCHIVED |
| direction_count | int? | количество направлений подготовки |
| student_count | int? | общая численность обучающихся |
| is_mock | boolean | |
| archived_at | timestamptz? | признак архива |

Индексы: `status`, `region`, `city`.

Рейтинг вуза **не хранится**: он вычисляется из показателей его программ. Хранить его —
значит получить два источника правды.

### contacts — контактные лица вуза

`university_id` → universities (CASCADE), `full_name`, `position?`, `email?`, `phone?`,
`is_primary`, `notes?`.

Минимум персональных данных: ФИО, должность, рабочие контакты. В логи не пишутся.

**Расширение относительно раздела 11 ТЗ:** в ТЗ контактное лицо перечислено как поля карточки
вуза (раздел 7.3). Вынесено в отдельную таблицу, потому что контактов бывает несколько и на них
ссылаются участники встреч (`meeting_participants`). В карточке вуза отдаётся `primaryContact`.

### educational_programs — образовательные программы

| Поле | Тип | Примечание |
| --- | --- | --- |
| university_id | text FK → universities (RESTRICT) | |
| name | text | |
| code, direction | text? | код и направление подготовки |
| level | ProgramLevel | SPO, BACHELOR, SPECIALIST, MASTER, POSTGRADUATE, DPO |
| duration_months | int? | |
| status | ProgramStatus | DRAFT, ACTIVE, SUSPENDED, ARCHIVED |
| **application_count** | int? | заявки на обучение |
| **student_count** | int? | количество обучающихся |
| **group_count** | int? | количество параллельных групп |
| metrics_source | DataOrigin? | откуда взяты показатели |
| metrics_updated_at | timestamptz? | когда обновлены |
| archived_at | timestamptz? | |

Три выделенных поля — единственные, из которых считается рейтинг программы (решение 7).
`metrics_source` и `metrics_updated_at` обязательны для объяснимости: без них показатель нельзя
подписать источником.

Индексы: `university_id`, `level`, `status`.

### skills, program_skills, product_skills

`skills`: `name` UNIQUE, `category`, `description?`. Индекс по `category`.

**Уникальность названия без учёта регистра и пробелов** — уникальный индекс по выражению
`skills_name_key_ci` (решение 110, миграция `20260925230100_skill_name_key_unique`):
«ML Ops» и «MLOps», «Python» и «python» — один навык. Выражение повторяет `skillNameKey`
из `skills.rules.ts` шаг в шаг:

```sql
regexp_replace(lower(normalize(name, NFKC) COLLATE "ru-x-icu"),
               '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g')
```

NFKC → нижний регистр по ICU с русской локалью → без пробельных знаков. Пробельные знаки
выписаны списком — ровно `\s` из JavaScript: `\s` PostgreSQL зависит от сортировки и с ICU
расходится с кодом (U+0085, U+001C–U+001F, U+FEFF). `lower` — до удаления пробелов, как в коде
(иначе греческая «Σ» в конце слова строчится по-разному). В `schema.prisma` индекса нет —
Prisma индексы по выражению не описывает; у модели комментарий, `prisma migrate diff`
его не видит и удалить не предлагает. Совпадение с кодом на трудных примерах
(`skill-name-key.samples.ts`) и на всех названиях справочника проверяет `db:verify`.
Точный `name` UNIQUE оставлен: он слабее и новому индексу не мешает, а его удаление —
отдельное изменение схемы без пользы для данных.

`program_skills`: `program_id` + `skill_id` UNIQUE, `level` (SkillLevel), `importance`
(SkillImportance), `source` (DataOrigin), `confidence` (ConfidenceLevel?), `comment?`.

Поле `coverage` из стартового каркаса заменено на четыре поля: уровень, важность, источник и
уверенность. Одно число не даёт ответить, почему навык считается покрытым.

`product_skills`: `product_id` + `skill_id` UNIQUE, `relevance` (CORE, RELATED, OPTIONAL).

### market_demand — востребованность навыка

| Поле | Тип | Примечание |
| --- | --- | --- |
| skill_id | text FK → skills (CASCADE) | |
| period | text | `2026-Q1` или `2026-03` |
| value | double | |
| unit | text | по умолчанию `vacancies` |
| region | text? | |
| source | text | текстовое имя источника |
| data_source_id | text? FK → data_sources | |
| confidence | ConfidenceLevel | |
| is_mock | boolean | по умолчанию **true** |

UNIQUE: (`skill_id`, `period`, `source`, `region`). Индексы: `period`, `data_source_id`.

Агрегированная таблица: одна строка — один навык за один период из одного источника.
Сырых вакансий система не хранит.

### it_products

`name` UNIQUE, `category`, `description?`, `documentation_url?`, `version?`,
`status` (PLANNED, ACTIVE, DEPRECATED), `is_mock`.

### cooperations — связка «вуз — программа — продукт»

| Поле | Тип | Примечание |
| --- | --- | --- |
| university_id | text FK (RESTRICT) | |
| program_id | text FK (RESTRICT) | |
| product_id | text? FK (SET NULL) | **допускает NULL**: продукт выбирается не сразу |
| status | CooperationStatus | DRAFT, ACTIVE, PAUSED, COMPLETED, CANCELLED |
| responsible_id | text FK → users (RESTRICT) | |
| goal, notes | text? | |
| first_contact_at | timestamptz? | начало отсчёта цикла |
| classes_start_at | timestamptz? | конец отсчёта цикла |
| target_date | timestamptz? | контрольное событие |
| started_at, closed_at | timestamptz? | |
| is_mock | boolean | |

Индексы: `university_id`, `program_id`, `product_id`, `status`, `responsible_id`.

`first_contact_at` и `classes_start_at` нужны показателю «среднее время до начала занятий»
из раздела 7.1 ТЗ и метрике эффекта из концепции.

Уникального ограничения на тройку (вуз, программа, продукт) **нет**: у одного вуза по одной
программе может идти несколько независимых потоков с разными продуктами и статусами — это
прямо описано в концепции.

### workflow_stages — 14 этапов

| Поле | Тип | Примечание |
| --- | --- | --- |
| cooperation_id | text FK (CASCADE) | |
| stage_number | int | 1..14 |
| title | text | **копия** названия на момент создания |
| phase | StagePhase | ATTRACTION, FORMALIZATION, IMPLEMENTATION, OPERATION, CONTROL |
| status | StageStatus | NOT_STARTED, IN_PROGRESS, BLOCKED, COMPLETED, CANCELLED |
| responsible_id | text? FK → users (SET NULL) | |
| deadline | timestamptz? | |
| comment, result, blocking_reason | text? | |
| started_at, completed_at | timestamptz? | |
| completed_by_id | text? FK → users (SET NULL) | |

UNIQUE: (`cooperation_id`, `stage_number`). Индексы: `status`, `deadline`, `responsible_id`,
`completed_by_id`.

Название этапа хранится копией, а не берётся из конфига при чтении: переименование этапа
в конфиге не должно задним числом менять историю уже пройденных связок.

`phase` — четыре фазы конвейера из концепции плюс отдельная фаза контроля для этапа 14.

### tasks — пункты чек-листа

`stage_id` (CASCADE), `title`, `is_required`, `is_done`, `done_at?`, `done_by_id?`, `sort_order`,
`is_university_item`, `confirmation_note?`.

Обязательные пункты блокируют перевод этапа в COMPLETED.

`is_university_item` — пункт вуза (решение 103): «Вуз подтвердил получение материалов»
этапа 7. Ставится из конфига (`universityItem` в `workflow.config.ts`) при создании этапов;
существующим пунктам проставлен миграцией `20260925210000_task_university_item` по номеру
этапа и заголовку. При действующем представителе вуза пункт отмечает только он.
`confirmation_note` — чем подтверждено, если пункт вуза отметил сотрудник (у вуза нет
представителя): «письмо от 12.09». Есть только у отмеченного пункта вуза, стирается
со снятием отметки. Уже отмеченные до миграции пункты вуза, отмеченные не представителем,
получили пометку «Отмечено сотрудником до решения 103: основание не записывалось».

### stage_history — история изменений этапа

`stage_id` (CASCADE), `from_status?`, `to_status`, `comment?`, `changed_by_id` (RESTRICT),
`changed_at`. Индексы: `stage_id`, `changed_at`, `changed_by_id`.

Пишется при каждой смене статуса, включая автоматический пересчёт этапа 14.

### documents, document_history, meetings, meeting_participants

`documents` привязывается к связке, вузу или программе (все три FK
необязательные), хранит `type`, `title`, `version`, `status`, `content`, `template_key`,
`file_reference`, `author_id`,
`responsible_id`, `issued_at`, `signed_at`. Файлы **не хранятся**: в MVP только метаданные и
ссылка (решение 14).
Индексы `documents`: `cooperation_id`, `university_id`, `program_id`, `status`, `author_id`,
`responsible_id`.
`document_history` хранит историю изменений документа. Индексы: `document_id`, `changed_at`,
`changed_by_id`.

`meeting_participants` допускает участника-пользователя, участника-контакт или внешнее имя
строкой.

Индексы `meetings.responsible_id` и `meeting_participants.user_id` (с 25.09.2026, миграция
`20260925210200_calendar_feeds`) — под выборку ленты календаря: встречи, где сотрудник
ответственный или участник.

### recommendations

`type`, `object_type`, `object_id`, `rule_key`, `title`, `description`, `priority`,
`justification`, `related_data` (jsonb), `confidence`, `status`, `resolution_comment?`,
`cooperation_id?`, `resolved_by_id?`, `resolved_at?`.

UNIQUE: (`rule_key`, `object_type`, `object_id`) — чтобы повторная генерация не плодила дубли,
а обновляла существующую запись.

`justification` и `resolution_comment` разделены намеренно: первое — обоснование системы,
второе — решение человека. Писать комментарий сотрудника поверх обоснования значило бы
потерять причину, по которой рекомендация вообще появилась.

### data_sources

`name` UNIQUE, `type` (MANUAL, CSV, EXTERNAL_API, LMS, SITE, MOCK), `url?`, `collection_date?`,
`reliability`, `description?`, `is_mock`.

### audit_log

`user_id?` (SET NULL), `action`, `object_type`, `object_id`, `payload` (jsonb?), `created_at`.
Индексы: (`object_type`, `object_id`), `created_at`, `user_id`.

Персональные данные в `payload` не пишутся — только служебные поля.

### calendar_feeds — подписка на календарь (решение 105)

`user_id` — первичный ключ и FK на `users` (CASCADE): одна подписка на пользователя.
`token_hash` UNIQUE — SHA-256 от токена личной ссылки, 64 шестнадцатеричных знака (CHECK).
`created_at` — когда выпущена действующая ссылка.

**Самого токена в базе нет**: утёкшая копия базы или резервная копия не открывает ни одну
ленту. Перевыпуск заменяет `token_hash` в той же строке, отзыв удаляет строку. `updated_at`
нет намеренно: строка не редактируется, а выпускается заново — время выпуска и есть `created_at`.
Суррогатного `id` тоже нет: строка определяется пользователем.

Персональных данных таблица не содержит; откат — в комментарии миграции.

### applications — заявки на обучение

`program_id` (CASCADE), `university_id` (CASCADE), `source`, `status`, `quantity`,
`comment?`, `external_ref?`, `created_by_id?`, `submitted_at`.

Персональных данных обучающихся не содержит. `quantity` позволяет вузу внести пакет заявок
одной записью. `application_count` программы пересчитывается по сумме `quantity` заявок в
статусах NEW, CONFIRMED, ENROLLED.

Состав полей заявки — рабочее значение, согласуется с заказчиком.

## Поведение при удалении

| Связь | Действие | Почему |
| --- | --- | --- |
| university → programs, cooperations | RESTRICT | нельзя потерять историю сотрудничества |
| university → contacts | CASCADE | контакт без вуза не имеет смысла |
| cooperation → stages, documents, meetings | CASCADE | часть одной сущности |
| stage → tasks, history | CASCADE | часть одной сущности |
| user → любые ссылки | SET NULL | увольнение сотрудника не удаляет историю |
| user → calendar_feeds | CASCADE | подписка без пользователя — доступ без владельца |
| skill → program_skills, product_skills, market_demand | CASCADE | связки без навыка бессмысленны |

## Согласованные изменения после первой версии

| Изменение | Зачем | Миграция |
| --- | --- | --- |
| `recommendations.resolution_comment` | Комментарий сотрудника при закрытии рекомендации. Раньше он затирал бы `justification` — обоснование системы | `20260921074512_recommendation_resolution_comment` |
| `documents.content`, `documents.template_key` | Текст, собранный из шаблона, и ключ шаблона. Без хранения текста «генерация документов из шаблонов» не оставляет после себя ничего. Это **текст, а не файл**: загрузка файлов остаётся P2 | `20260921082617_document_template_content` |
| `calendar_feeds` | Личная подписка на календарь сроков и встреч, в базе только хеш токена (решение 105). Индексы для ленты (`meetings.responsible_id`, `meeting_participants.user_id`) — из миграции внешних ключей (решение 104) | `20260925210200_calendar_feeds` |
| `skills_name_key_ci` — уникальный индекс по выражению | Уникальность названия навыка без учёта регистра и пробелов держит база, а не блокировка в коде (решение 110). Если в базе уже есть дубли, миграция падает с их списком и ничего не меняет | `20260925230100_skill_name_key_unique` |

## Что обсудить с Тиграном

1. Представления и агрегирующие запросы для рейтинга (обещаны в концепции) пока не созданы:
   рейтинг считается в приложении. На объёме MVP это дешевле; при росте данных переносим в СУБД.
2. Политики RLS (обещаны в концепции) не заведены — доступ ограничивается в сервисах.
   Ограничение зафиксировано в [SECURITY_LIMITATIONS.md](SECURITY_LIMITATIONS.md).
3. Роль базы `skilllink` получила право `CREATEDB` — оно нужно `prisma migrate` для теневой базы.
   В промышленном контуре миграции применяются командой `prisma migrate deploy`, и это право
   не требуется.
4. Нужно ли уникальное ограничение на тройку (вуз, программа, продукт) в `cooperations` —
   сейчас намеренно нет.
5. **Русская сортировка на колонках** — миграция `20260922073000_russian_collation`,
   согласована: Тигран слил её 22.09.2026. Двенадцати колонкам сортировки задана `COLLATE "ru-x-icu"`:
   без неё кириллица на macOS сортируется почти случайно, а в `postgres:16-alpine` —
   по кодам символов. Разбор — решение 35 в `TECHNICAL_DECISIONS.md`.
6. **Уникальный индекс по выражению `skills_name_key_ci`** — миграция
   `20260925230100_skill_name_key_unique` (решение 110), на согласование. Держит уникальность
   названия навыка без учёта регистра и пробелов. На данных с дублями миграция падает
   с их списком, не меняя ничего; порядок разбора — в шапке миграции. Индекс завязан на
   ICU (`ru-x-icu`): при обновлении ICU на сервере PostgreSQL предупредит о смене версии
   сортировки — тогда `REINDEX INDEX skills_name_key_ci`.
