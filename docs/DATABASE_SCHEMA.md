# DATABASE_SCHEMA.md — схема базы данных

Источник истины — `prisma/schema.prisma`. Этот документ описывает решения, которые из кода
не видны. С решения 143 (26.09.2026) изменения схемы согласует команда сама — раздел
«Ревью схемы 26.09.2026 (решение 143)» ниже.

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
| `contacts_consent_status_check` | статус согласия не `NONE` ровно при основании `CONSENT` (миграция `20260925230200_contact_legal_basis`, решение 111) |
| `contacts_consent_details_check` | дата и форма согласия — ровно при `OBTAINED` и `WITHDRAWN` |
| `contacts_consent_withdrawal_check` | дата и документ отзыва — ровно при `WITHDRAWN`; отзыв не раньше получения |
| `contacts_basis_reference_check` | документ-основание и дата фиксации — ровно при заданном основании |
| `contact_basis_history_consent_status_check` | в истории: статус согласия не `NONE` ровно при `to_basis = CONSENT` |
| `users_session_version_check` | версия сессий ≥ 0 (миграция `20260925230000_user_session_version`) |
| `forecast_models_coefficients_check` | коэффициенты модели заполнены ровно тогда, когда статус `PUBLISHED` (миграция `20260926140000_forecast_models`, решение 135) |
| `recommendation_rule_stats_scope_type_check` | уровень статистики — `global`, `university` или `manager` (миграция `20260926120000_recommendation_learning`, решение 119) |
| `recommendation_rule_stats_counts_check` | счётчики ≥ 0, успехов не больше показов: `successes ≤ trials`, `successes_eff ≤ trials_eff` |
| `audit_log_chain_check` | у записи журнала есть номер цепочки > 0 и SHA-256; `prev_hash` нет ровно у № 1 (миграция `20260926000000_audit_hash_chain`, решение 115) |
| `audit_seals_head_check` | хеш печати есть ровно у непустой цепочки, 32 байта |
| `audit_chain_cuts_check` | точка чистки — номер > 0, хеш 32 байта, удалено > 0 строк |
| `recommendation_signals_arm_check` | у `control` нет `recommendation_id` и он назначен только по хешу (миграция `20260926000000_recommendation_signals`, решение 136) |
| `recommendation_signals_assigned_by_check` | `assigned_by` из закрытого списка (`hash`, `experiment-off`, `excluded-rule`, `already-shown`, `dismissed`, `resolved`) |

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
(решение 110); у полученного согласия есть дата и форма, отозванное согласие — у
обезличенного контакта с датой и документом отзыва, основание контакта совпадает
с последней записью его истории (решение 111); в статистике правил рекомендаций
`successes_eff ≤ trials_eff` и успехов не больше показов, успех засчитан только показанной
рекомендации, балл — в [0..1] (решение 119). Последнее правило — цепочка хешей
журнала действий цела и сходится с печатями: проверка функцией в базе и независимо кодом
приложения, в своей транзакции REPEATABLE READ READ ONLY (решение 115). С `--demo` — ещё
пометка `is_mock` у всего демо-набора.

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
| session_version | integer, по умолчанию 0 | версия сессий (решение 109): кладётся в JWT при входе и сверяется на каждый запрос. +1 при смене и сбросе пароля, блокировке и смене роли — выданные раньше сессии перестают действовать. CHECK ≥ 0 |

Индексы: `role`, `university_id`. Под `session_version` индекса нет: она читается вместе
с пользователем по первичному ключу.

### universities — образовательные организации

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | |
| name, city, region | text | обязательные |
| short_name, address, website, description | text? | |
| status | UniversityStatus | NEW, IN_PROGRESS, ACTIVE, PAUSED, ARCHIVED |
| direction_count | int? | количество направлений подготовки |
| student_count | int? | общая численность обучающихся |
| inn | text? | ИНН организации, ровно 10 цифр (CHECK), контрольная цифра — на вводе (решение 134) |
| ogrn | text? | ОГРН организации, ровно 13 цифр (CHECK), контрольная цифра — на вводе (решение 134) |
| merged_into_id | text? FK → universities | вуз слит в другой (решение 134): CHECK — не на себя и только у архивной записи |
| is_mock | boolean | |
| archived_at | timestamptz? | признак архива |

Индексы: `status`, `region`, `city`, `merged_into_id`, `inn`, GIN по `name` (`gin_trgm_ops`,
решение 134) — кандидатов в дубли по названию отбирает оператор `%`.

Рейтинг вуза **не хранится**: он вычисляется из показателей его программ. Хранить его —
значит получить два источника правды.

### contacts — контактные лица вуза

`university_id` → universities (CASCADE), `full_name`, `position?`, `email?`, `phone?`,
`is_primary`, `notes?`.

Минимум персональных данных: ФИО, должность, рабочие контакты. В логи не пишутся.

**Расширение относительно раздела 11 ТЗ:** в ТЗ контактное лицо перечислено как поля карточки
вуза (раздел 7.3). Вынесено в отдельную таблицу, потому что контактов бывает несколько и на них
ссылаются участники встреч (`meeting_participants`). В карточке вуза отдаётся `primaryContact`.

**Правовое основание обработки ПД (решение 111, миграция `20260925230200_contact_legal_basis`):**

| Поле | Тип | Примечание |
| --- | --- | --- |
| legal_basis | ContactLegalBasis? | `LEGITIMATE_INTEREST` (п. 7 ч. 1 ст. 6 — договор с вузом), `CONTRACT` (п. 5 — договор с самим контактом), `CONSENT` (п. 1), `OTHER`. NULL — не зафиксировано |
| consent_status | ConsentStatus | `NONE` (по умолчанию), `OBTAINED`, `WITHDRAWN` |
| consent_obtained_at, consent_form | timestamptz?, ConsentForm? | при `OBTAINED`/`WITHDRAWN`; форма `WRITTEN`, `ELECTRONIC`, `ORAL_CONFIRMED_BY_EMAIL` |
| consent_withdrawn_at, withdrawal_reference | timestamptz?, text? | только при `WITHDRAWN` |
| basis_reference | text? | где лежит документ-основание (номер, дата, место хранения). Не файл |
| basis_updated_at | timestamptz? | когда основание фиксировали в последний раз |

Согласованность полей держат четыре CHECK (выше). Существующие контакты получили NULL/`NONE`:
основание задним числом не выдумывается. Индексов нет: по этим полям не ищут, `db:verify`
проходит таблицу целиком (контактов — сотни).

### contact_basis_history — история основания и согласия (решение 111)

`contact_id` (CASCADE), `from_basis?`, `to_basis`, `from_consent_status`, `to_consent_status`,
`consent_obtained_at?`, `consent_form?`, `consent_withdrawn_at?`, `reference_changed`,
`anonymized`, `changed_by_id` (RESTRICT, как у `stage_history`), `changed_at`.
Индексы: (`contact_id`, `changed_at`) — под историю контакта по времени; `changed_by_id` — FK.

**Свободного текста нет** — ни комментария, ни копии документа-основания (только признак
`reference_changed`): история переживает обезличивание контакта и служит выгрузкой для акта
уничтожения, ПД в ней оказаться не должно. Пишется в одной транзакции с изменением контакта
под `FOR UPDATE` строки контакта.

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
`status` (PLANNED, ACTIVE, DEPRECATED), `is_mock`. С решения 132 — `vendor_id?` (SET NULL):
продукт до решения 132 или без известного вендора — NULL, обратная совместимость.

### vendors, vendor_contacts, vendor_contact_products — вендоры (решение 132)

Компания-вендор IT-продукта (ООО «Базис», ПАО «Ростелеком» и другие компании группы) и её
контактные лица. Загружаются файлом организаторов (`Вендоры.xlsx`) — `POST /api/import/vendors`.

| Таблица | Поле | Тип | Примечание |
| --- | --- | --- | --- |
| `vendors` | `name` | text | как в файле |
| | `name_key` | text UNIQUE | ключ названия — `catalogNameKey`, тот же принцип, что `skillNameKey` (решение 110): NFKC, нижний регистр, без кавычек-ёлочек и пробелов. **Колонка, не индекс по выражению** — считает только код (`db:verify` сверяет), в отличие от навыков, где уникальность держит база (решение 110) |
| `vendor_contacts` | `vendor_id` | text FK (CASCADE) | контакт без вендора не имеет смысла |
| | `full_name`, `email?`, `phone?` | text | телефон `+7XXXXXXXXXX`, почта в нижнем регистре |
| | `preferred_channels` | `VendorContactChannel[]` | `EMAIL`, `TELEGRAM`, `PHONE` |
| | `legal_basis` | `ContactLegalBasis` | по умолчанию `LEGITIMATE_INTEREST` — деловой контакт (docs/PRIVACY.md, раздел 3); без учёта согласия/отзыва — не физлицо-контрагент, решение 111 не распространяется |
| | `basis_reference?` | text | где лежит основание — файл вендора, письмо, договор |
| `vendor_contact_products` | `contact_id`, `product_id` | text FK (CASCADE) | составной PK — за какие продукты вендора отвечает контакт (в файле контакт указан у строки продукта) |

Индексы: `vendor_contacts.vendor_id`, `vendor_contact_products.product_id`,
`it_products.vendor_id`. `db:verify` — контакт вендора отвечает только за продукты своего
вендора (иначе внешние ключи не держат).

### school_courses, course_streams, site_orders — набор ИТ-Школы (решение 132)

Заказы на курсы ИТ-Школы с сайта → LMS, с минимизацией ПД слушателей (docs/PRIVACY.md,
раздел 2.4). Курс — отдельная сущность от `educational_programs`: заказ делает частный
слушатель, а не вуз, и в рейтинг программ (решения 9, 22) не входит.

| Таблица | Поле | Тип | Примечание |
| --- | --- | --- | --- |
| `school_courses` | `name`, `name_key` UNIQUE | text | тот же `catalogNameKey`, что у вендоров |
| | `product_id?` | text? FK (SET NULL) | курс «на базе продукта» — необязательно |
| `course_streams` | `course_id` | text FK (CASCADE) | поток без курса не имеет смысла |
| | `number` | int | «Номер потока» из заказа; CHECK `number >= 1`; UNIQUE(`course_id`, `number`) |
| | `starts_at?` | timestamptz? | не приходит в заказе — заполняется отдельно |
| `site_orders` | `order_no` UNIQUE | text | `ORD-ГГГГММДДЧЧММСС-XXXXXX` — ключ повторной загрузки |
| | `course_id` | text FK (RESTRICT) | заказ без известного курса не загружается (ошибка предпросмотра, не создание) |
| | `stream_id?` | text? FK (SET NULL) | поток известен не всегда |
| | `email_hash?`, `phone_hash?` | text? | HMAC-SHA256 нормализованных почты/телефона, ключ `ORDERS_HMAC_KEY` вне базы — **не ФИО, не почта, не телефон** (docs/PRIVACY.md, раздел 2.4); CHECK — 64 шестнадцатеричных знака, хотя бы один задан |
| | `ordered_at?` | timestamptz? | дата из номера заявки; NULL — номер битый (месяц 17, секунды 69, 15 цифр) |
| | `import_batch_id` | text | какой загрузкой создан |
| | `imported_by_id?` | text? FK → users (SET NULL) | кто загрузил |
| | `lms_exported_at?` | timestamptz? | когда ушёл в файл для LMS; NULL — ещё не уходил |

Индексы: `course_id`, `stream_id`, `email_hash`, `phone_hash`, `import_batch_id`,
`imported_by_id`. `db:verify` — поток заказа относится к курсу заказа (иначе внешние ключи
не держат: `stream_id` и `course_id` — независимые FK).

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

Из неё же восстанавливается хронология текущего этапа — длительность этапов по
Каплану–Мейеру, воронка и когорты (решение 120, docs/ANALYTICS_MODEL.md). Отдельной
таблицы переходов нет: она дублировала бы эту. Поэтому у этапа 1–13 не в статусе
«Не начат» запись в истории обязательна — это проверяет `npm run db:verify`.

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

### recommendation_signals — контрольная группа рекомендаций (решение 136)

Журнал: «правило сработало по объекту» — пишется всегда, даже если эксперимент выключен.
`rule_type`, `entity_type`, `entity_id`, `period_key` (отрезок в `horizonDays` дней от
01.01.1970 UTC — «30d-684»), `fired_at`, `arm` (enum `ExperimentArm`: `treatment` | `control`),
`assigned_by` (`hash` — случайно, участвует в оценке; `experiment-off`, `excluded-rule`,
`already-shown`, `dismissed`, `resolved` — вне оценки, всегда `treatment`), `recommendation_id?`
(FK на `recommendations`, SET NULL), `context` (jsonb — этап связки, программы навыка, доля
контроля на момент сигнала), `outcome_at?`, `outcome?` (jsonb — `{ state, days, event,
evaluatedAt }`), `created_at`.

UNIQUE: (`rule_type`, `entity_type`, `entity_id`, `period_key`) — один сигнал на правило,
объект и период; повторная пересборка не назначает группу заново.

CHECK `recommendation_signals_arm_check` — у `control` нет `recommendation_id` и он назначен
только по хешу (`assigned_by = 'hash'`): иначе «контрольная группа» видела бы рекомендацию.
CHECK `recommendation_signals_assigned_by_check` — `assigned_by` из закрытого списка.

Персональных данных в таблице нет: правило, объект (связка, программа, навык), время,
группа и исход движения. Подробности сбора и оценки — [RECOMMENDATIONS_EXPERIMENT.md](RECOMMENDATIONS_EXPERIMENT.md).

**Решение 119** (миграция `20260926120000_recommendation_learning`): `score?` (double, 0..1),
`score_breakdown?` (jsonb — разбор балла), `reasons?` (jsonb — `[{code, pass, label, detail, facts}]`),
`is_deferred` (bool, по умолчанию false), `shown_at?` — последний показ (создана или открыта снова),
`success_at?` — когда показ засчитан полезным. Индекс по `score` — лента `sort=-score`.
Записи, созданные до миграции, остаются без показа и балла до первой пересборки.

### recommendation_rule_stats — статистика правил рекомендаций (решение 119)

`rule_type`, `scope_type` (`global` | `university` | `manager`), `scope_id` (`all` для общего
уровня, иначе id вуза или пользователя — без внешнего ключа: строка статистики переживает
архив вуза и увольнение), `trials`, `successes` (int, полные), `trials_eff`, `successes_eff`
(double, с затуханием, не округляются), `eff_updated_at` (timestamp; решение 143 — было
timestamptz, единственная колонка с поясом в схеме, приведена к общему соглашению «пишем UTC»).

PK: (`rule_type`, `scope_type`, `scope_id`). Пишется только одним
`INSERT … ON CONFLICT DO UPDATE` с затуханием в SQL (`recommendations.stats.repo.ts`) —
параллельные события не теряются. Формулы — [RECOMMENDATIONS_MODEL.md](RECOMMENDATIONS_MODEL.md).
Персональных данных нет: id менеджера — ссылка, не ФИО. `db:verify` (решение 143) сверяет
`scope_id` со смыслом `scope_type` ('all' — общий, иначе существующий вуз или пользователь).

### data_sources

`name` UNIQUE, `type` (MANUAL, CSV, EXTERNAL_API, LMS, SITE, MOCK), `url?`, `collection_date?`,
`reliability`, `description?`, `is_mock`.

### forecast_models — прогноз «дойдёт ли связка до вехи» (решение 135)

`milestone_stage` UNIQUE — номер этапа вехи (подписание договора, начало занятий):
новое обучение заменяет запись той же вехи, `version` растёт. `status` (`PUBLISHED`,
`BASELINE_BETTER`, `INSUFFICIENT_DATA`) — итог ворот публикации, `trained_at` — когда
обучена. `metrics` (jsonb) — AUC, Brier, калибровка, размер выборки; `coefficients`
(jsonb?) — свободный член и веса по стандартизованным признакам, `NULL`, пока данных
не хватает; `feature_stats` (jsonb) — медианы этапов, среднее/отклонение/квантили
признаков для объяснений и PSI, частоты базовой линии по этапам.

Прогноз конкретной связки не хранится — считается на лету от этой записи и текущего
состояния связки (docs/FORECAST_MODEL.md). Таблица не содержит персональных данных:
`src/modules/dsar/dsar.registry.ts`, `DSAR_NOT_PERSONAL`.

### audit_log

`user_id?` (RESTRICT, до решения 115 — SET NULL), `action`, `object_type`, `object_id`,
`payload` (jsonb?), `created_at`, `chain_seq` (bigint UNIQUE), `prev_hash`, `row_hash` (bytea).
Индексы: (`object_type`, `object_id`), `created_at`, `user_id`, уникальный `chain_seq`.

Персональные данные в `payload` не пишутся — только служебные поля.

**Цепочка хешей (решение 115, миграция `20260926000000_audit_hash_chain`).** Всё ниже —
только в SQL миграции, Prisma о нём не знает:

| Объект | Что делает |
| --- | --- |
| триггер `zz_audit_chain_link` (BEFORE INSERT) | под `pg_advisory_xact_lock` берёт голову цепочки и ставит `chain_seq = голова + 1`, `prev_hash = row_hash головы`, `row_hash`; значения из INSERT перезаписываются. Имя с `zz_` — чтобы срабатывать последним из BEFORE-триггеров |
| триггеры `audit_log_append_only`, `audit_log_no_truncate` (и такие же у `audit_seals`, `audit_chain_cuts`) | запрещают UPDATE, DELETE и TRUNCATE; обход — `SET LOCAL skilllink.allow_audit_purge = 'on'` |
| `audit_row_canonical(…)` | каноническая запись: `json_build_array('v1', chain_seq, id, user_id, action, object_type, object_id, payload без address как jsonb::text, created_at как YYYY-MM-DDTHH:MI:SS.ffffffZ)::text` |
| `audit_row_hash(prev, canonical)` | `sha256(hex(prev) или 'GENESIS' ‖ '\|' ‖ canonical)` |
| `audit_verify_chain(schema)` | проверка по `chain_seq` и сверка с печатями; STABLE — один снимок |
| `audit_take_seal(schema)` | печать под той же блокировкой |
| `audit_purge_before(cutoff, apply, schema)` | чистка по сроку: удаляет начало цепочки, пишет точку чистки; голову не удаляет. EXECUTE снят с PUBLIC |
| `audit_chain_install(schema)` | ставит триггеры; тест цепочки ставит ими триггеры во временной схеме. EXECUTE снят с PUBLIC |

Порядок цепочки — `chain_seq`, а не `id` (cuid) и не `created_at`: время записи
приложение ставит до вставки, номер выдаётся в момент вставки под блокировкой.
Существующие строки получили номера в порядке (`created_at`, `id`).

### audit_seals — печати журнала (решение 115)

`id` (bigserial), `head_seq` (номер головы, 0 — журнал пуст), `head_hash?` (bytea),
`row_count`, `created_at`. Только дописывается (триггер; роли приложения — без UPDATE и DELETE).
Снимает `npm run audit:seal`. Смысл у печати — её копия вне базы: удаливший хвост журнала
удалит и печать в базе, а сообщение владельцу — нет.

### audit_chain_cuts — точки чистки журнала (решение 115)

`id` (bigserial), `cut_seq` UNIQUE (номер последней удалённой строки), `cut_hash`
(её `row_hash` — `prev_hash` первой оставшейся), `deleted_rows`, `cutoff`, `created_at`.
Пишет только `audit_purge_before()`; роли приложения — только чтение. Проверка начинает
цепочку с последней точки чистки; пустой журнал после чистки продолжает нумерацию от неё.

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

### telegram_links — привязка к личному чату Telegram

Миграция `20260925200000_telegram_links`, решение 102. Кому из сотрудников и в какой чат
слать сводку «что горит у меня».

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | cuid |
| user_id | text UNIQUE FK → users | CASCADE: удалён пользователь — удалена привязка |
| chat_id | text UNIQUE | идентификатор личного чата Telegram; целое до 52 бит, поэтому строка |
| username | text? | ник в Telegram без `@`, если есть, — чтобы человек узнал свой аккаунт в кабинете |
| linked_at | timestamp | когда привязан (при перепривязке обновляется) |

Индексы: уникальные `user_id` (профиль, рассылка) и `chat_id` (команды бота «чей это чат»).
Одна учётная запись — один чат, один чат — одна учётная запись: при новой привязке чат
снимается с прежней учётной записи. `updated_at` нет: запись не редактируется, а
перезаписывается при новой привязке, и `linked_at` её время. Удаляется командой `/stop`,
кнопкой «Отключить» и вместе с пользователем. Токен привязки в базе не хранится (подпись HMAC).

### duplicate_dismissals — пары «не дубль» (решение 134)

Миграция `20260926090000_data_quality`. Отметка «эти две записи похожи, но не дубль» —
поиск дублей больше её не предлагает.

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | cuid |
| entity | text | `university` \| `skill` \| `program` \| `product` (CHECK) |
| first_id, second_id | text | пара хранится упорядоченной: CHECK `first_id < second_id` (по кодам символов, `COLLATE "C"` — как сравнение строк в JS, а не по локали кластера) |
| comment | text? | почему не дубль — увидит тот, кто встретит пару снова |
| dismissed_by_id | text FK → users, RESTRICT | кто отметил — доказательство решения |
| created_at | timestamp | |

Индексы: уникальный `(entity, first_id, second_id)`, `dismissed_by_id`. На сами записи
(вуз, навык, программу, продукт) ссылок нет: сущности разные, а исключение про удалённую
запись просто ни на что не влияет.

### university_merges — журнал слияний вузов (решение 134)

Миграция `20260926090000_data_quality`. Тот же принцип, что у объединения навыков
(решение 107): более сильная запись остаётся, дубль архивируется со ссылкой
(`universities.merged_into_id`), а не удаляется — слияние можно отменить.

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | cuid |
| source_id, target_id | text FK → universities, RESTRICT | CHECK `source_id <> target_id` |
| merged_by_id | text FK → users, RESTRICT | администратор, выполнивший слияние |
| merged_at | timestamp | |
| undo_until | timestamp | до какого момента можно отменить (`merged_at` + 30 дней) |
| field_rules | jsonb | правило по каждому переносимому полю: `non_null` \| `most_recent` \| `longest` \| `manual` |
| survivorship | jsonb | журнал выживания: по каждому полю — правило, откуда взято значение, было/стало |
| moved | jsonb | id перенесённых объектов по таблицам — чтобы отмена знала, что вернуть |
| before | jsonb | состояние цели и источника до слияния — чтобы отмена восстановила его |
| undone_at, undone_by_id | timestamp?, text? FK → users, SET NULL | CHECK: `undone_by_id` без `undone_at` не бывает |

Индексы: `source_id`, `target_id`, `merged_by_id`, `undone_by_id`. В `survivorship` и `before`
— только поля вуза (название, город, контакты и т. п. по значению) и идентификаторы:
ФИО и контакты не копируются, поэтому таблица не хранит персональные данные контактов.

### dsar_requests — реестр запросов субъектов ПД (решение 116)

Миграция `20260926011600_dsar_requests`. Кто и о ком просил сведения или уничтожение ПД,
срок ответа и когда исполнено — доказательство исполнения ст. 14 и 20 152-ФЗ.

| Поле | Тип | Примечание |
| --- | --- | --- |
| id | text PK | cuid |
| subject_type | `DsarSubjectType` | USER или CONTACT |
| subject_id | text | идентификатор пользователя или контакта; **без FK** — субъект двух видов (сверяет `db:verify`) |
| kind | `DsarRequestKind` | EXPORT — сведения (ст. 14), ERASE — уничтожение (ч. 3 ст. 20) |
| channel | `DsarRequestChannel` | SELF_SERVICE — сам в кабинете, LETTER — письмо, ADMIN — выгрузка администратором без письма |
| requested_by_id | text FK → users | RESTRICT: кто зарегистрировал (у SELF_SERVICE — сам субъект) |
| requested_at | timestamp | когда оператор получил запрос — от неё идёт срок |
| due_at | timestamp | конец последнего рабочего дня по Москве: +10 рабочих дней на сведения, +7 на уничтожение |
| completed_at | timestamp? | ровно у исполненного (CHECK) |
| status | `DsarRequestStatus` | OPEN, COMPLETED |
| summary | jsonb? | итог: счётчики по разделам, без самих данных |
| ip | text? | адрес клиента у SELF_SERVICE; ≤ 64 знаков (CHECK) |

Индексы: (`subject_type`, `subject_id`, `requested_at`) — запросы субъекта и частота
самостоятельной выгрузки; (`status`, `due_at`) — открытые и просроченные; `requested_by_id`.
CHECK: `due_at > requested_at`, `completed_at ≥ requested_at`, COMPLETED ⇔ `completed_at`.
**Только INSERT и закрытие:** триггер `dsar_requests_guard` отклоняет изменение всего, кроме
статуса, даты исполнения, итога и стирания `ip`, и повторное открытие исполненного запроса;
роли приложения `DELETE` не выдан (`create-app-role.sql`). Сид удаляет строки владельцем.
ПД в строке нет, кроме идентификаторов и адреса.

### telegram_updates_seen, system_secrets, approvals, idempotency_keys — безопасность, волна 2 (решение 133)

Миграция `20260926120000_security_wave_2`. Четыре служебные таблицы без персональных данных.

- **telegram_updates_seen** — `update_id` (bigint PK, ≥ 0) обработанных обновлений вебхука:
  `INSERT … ON CONFLICT DO NOTHING` не даёт выполнить одно обновление дважды после
  перезапуска процесса. `seen_at` (индекс) — для чистки строк старше 7 суток
  (`npm run db:retention`, попутно чистит и приложение само).
- **system_secrets** — `name` (text PK, код секрета, сейчас только вебхук Telegram),
  `value_hash` (SHA-256 hex, CHECK), `rotated_at`, `rotated_by_id?` (FK → users, SET NULL).
  Хранится только хеш: сверить входящий секрет можно, а прочитать значение из базы — нет.
- **approvals** — «четыре глаза» на опасную операцию (включается `APPROVALS_REQUIRED=true`):
  `action`, `payload` (jsonb, только идентификаторы), `payload_hash` (hex SHA-256, CHECK),
  `status` (`ApprovalStatus`: REQUESTED, APPROVED, REJECTED, CONSUMED, EXPIRED),
  `requested_by_id`/`approved_by_id`/`rejected_by_id` (FK → users, RESTRICT — решение,
  доказательство), `created_at`, `decided_at?`, `expires_at`, `consumed_at?`. CHECK:
  одобривший ≠ запросившему, `payload_hash` — hex SHA-256, `expires_at > created_at`,
  CONSUMED ⇔ `consumed_at`, REJECTED ⇒ `rejected_by_id`; решение 143 добавил
  `approvals_decided_at_check` — `decided_at` пуст ровно у REQUESTED и заполнен у
  APPROVED/REJECTED/CONSUMED (EXPIRED — особый случай: истечь может и ждущий, и уже
  одобренный запрос). Использование — один атомарный UPDATE (`approvals.repo.ts`).
- **idempotency_keys** — PK (`user_id`, `key`) для POST-создания по заголовку
  `Idempotency-Key`: повтор с тем же ключом и телом отдаёт сохранённый ответ. `request_hash`
  (hex SHA-256 метода, пути и тела, CHECK), `status` (`IdempotencyStatus`: IN_PROGRESS,
  SUCCEEDED ⇔ `response_status`), `response_body?` (jsonb). Живёт 24 часа, чистится
  приложением и `db:retention`.

Права роли приложения на эти четыре таблицы не сужены (`create-app-role.sql`) — ни одна
не защищена триггером запрета правки; сверка список-в-список сделана решением 143.

### notifications_seen_at (решение 139)

`users.notifications_seen_at` (timestamp?) — когда пользователь последний раз открывал
ленту уведомлений; источник истины на сервере (`POST /api/notifications/seen`).
`localStorage` на фронте остаётся быстрым кэшем, а не хранилищем: иначе прочитанность
терялась бы при смене устройства или очистке хранилища. Отдельного CHECK не требует —
обычная метка времени без связей с другими таблицами.

## Поведение при удалении

| Связь | Действие | Почему |
| --- | --- | --- |
| university → programs, cooperations | RESTRICT | нельзя потерять историю сотрудничества |
| university → contacts | CASCADE | контакт без вуза не имеет смысла |
| cooperation → stages, documents, meetings | CASCADE | часть одной сущности |
| stage → tasks, history | CASCADE | часть одной сущности |
| contact → contact_basis_history | CASCADE | история основания без контакта бессмысленна; контакты не удаляются, а обезличиваются |
| user → contact_basis_history | RESTRICT | автор фиксации основания — доказательство, как в `stage_history` |
| user → любые ссылки | SET NULL | увольнение сотрудника не удаляет историю |
| user → audit_log | RESTRICT (с решения 115) | обнуление автора — правка журнала, её не пропустит триггер; сотрудник блокируется и обезличивается, а не удаляется |
| user → telegram_links | CASCADE | привязка — не история, без пользователя она не нужна (решение 102) |
| user → calendar_feeds | CASCADE | подписка без пользователя — доступ без владельца |
| user → dsar_requests (`requested_by_id`) | RESTRICT | кто зарегистрировал запрос субъекта — доказательство; пользователи не удаляются, а обезличиваются (решение 116) |
| skill → program_skills, product_skills, market_demand | CASCADE | связки без навыка бессмысленны |
| university → university_merges (source, target) | RESTRICT | журнал слияния — доказательство, вуз (даже архивный) не удаляется, пока запись слияния есть |
| university → universities (merged_into_id) | SET NULL | по умолчанию Prisma для необязательной самоссылки; на практике не наступает — слитый вуз не удаляется |
| user → duplicate_dismissals, university_merges (merged_by) | RESTRICT | автор отметки/слияния — доказательство, как в `stage_history` |
| user → university_merges (undone_by) | SET NULL | увольнение сотрудника не стирает факт отмены слияния |
| vendor → it_products | SET NULL | продукт остаётся, если вендора убрали (обратная совместимость, решение 132) |
| vendor → vendor_contacts | CASCADE | контакт без вендора не имеет смысла |
| vendor_contact / it_products → vendor_contact_products | CASCADE | связка контакта с продуктом — часть одной сущности |
| it_product → school_courses | SET NULL | курс остаётся, если продукт убрали |
| school_course → course_streams, site_orders | RESTRICT (заказы), CASCADE (потоки) | заказы нельзя потерять молча — курс с заказами не удаляется; потоки без курса не нужны |
| course_stream → site_orders | SET NULL | заказ не привязан к потоку жёстко — поток можно убрать |
| user → site_orders (imported_by_id) | SET NULL | увольнение не удаляет историю загрузок |

## Согласованные изменения после первой версии

| Изменение | Зачем | Миграция |
| --- | --- | --- |
| `recommendations.resolution_comment` | Комментарий сотрудника при закрытии рекомендации. Раньше он затирал бы `justification` — обоснование системы | `20260921074512_recommendation_resolution_comment` |
| `documents.content`, `documents.template_key` | Текст, собранный из шаблона, и ключ шаблона. Без хранения текста «генерация документов из шаблонов» не оставляет после себя ничего. Это **текст, а не файл**: загрузка файлов остаётся P2 | `20260921082617_document_template_content` |
| `calendar_feeds` | Личная подписка на календарь сроков и встреч, в базе только хеш токена (решение 105). Индексы для ленты (`meetings.responsible_id`, `meeting_participants.user_id`) — из миграции внешних ключей (решение 104) | `20260925210200_calendar_feeds` |
| `skills_name_key_ci` — уникальный индекс по выражению | Уникальность названия навыка без учёта регистра и пробелов держит база, а не блокировка в коде (решение 110). Если в базе уже есть дубли, миграция падает с их списком и ничего не меняет | `20260925230100_skill_name_key_unique` |
| `users.session_version` | Отзыв выданных JWT-сессий при смене и сбросе пароля, блокировке и смене роли (решение 109). Существующим строкам — 0, токен без версии тоже считается 0: выкладка никого не разлогинивает. Добавление колонки с константным DEFAULT таблицу не переписывает. Откат — в комментарии миграции | `20260925230000_user_session_version` |
| Основание обработки ПД у `contacts` (8 колонок, 3 перечисления, 4 CHECK), таблица `contact_basis_history` | Учёт оснований и согласий контактов вузов (152-ФЗ, решение 111). Согласовано (решение 143) | `20260925230200_contact_legal_basis` |
| Цепочка хешей `audit_log` (3 колонки, CHECK, триггеры, функции), таблицы `audit_seals`, `audit_chain_cuts`, FK автора журнала — RESTRICT | Журнал только дописывается и защищён от подмены (решение 115). Таблица на время миграции закрыта на запись; заполнение существующих строк — один проход. Откат — в комментарии миграции. Согласовано (решение 143) | `20260926000000_audit_hash_chain` |
| Таблица `dsar_requests`, 4 перечисления, 4 CHECK, триггер `dsar_requests_guard` | Реестр запросов субъектов ПД со сроком ответа (решение 116). Согласовано (решение 143) | `20260926011600_dsar_requests` |
| 6 колонок `recommendations`, таблица `recommendation_rule_stats` (2 CHECK) | Рекомендации учатся на решениях сотрудников и объясняют себя (решение 119). Согласовано, с правкой (решение 143: `eff_updated_at` — TIMESTAMPTZ(6) → TIMESTAMP(3), миграция `20260926200000_schema_review`). Откат: `DROP TABLE "recommendation_rule_stats"; ALTER TABLE "recommendations" DROP COLUMN "score", DROP COLUMN "score_breakdown", DROP COLUMN "reasons", DROP COLUMN "is_deferred", DROP COLUMN "shown_at", DROP COLUMN "success_at";` | `20260926120000_recommendation_learning` |
| `universities.inn`, `.ogrn`, `.merged_into_id`; таблицы `duplicate_dismissals`, `university_merges`; расширение `pg_trgm`; GIN-индексы по названиям (вузы, программы, навыки, IT-продукты) | Поиск дублей, слияние вузов, ИНН/ОГРН (решение 134). Согласовано, с правкой (решение 143: `university_merges_undone_check` сделан симметричным, миграция `20260926200000_schema_review`) | `20260926090000_data_quality` |
| Таблицы `vendors`, `vendor_contacts`, `vendor_contact_products`, `school_courses`, `course_streams`, `site_orders`; `it_products.vendor_id` | Вендоры IT-продуктов и набор на курсы ИТ-Школы с минимизацией ПД слушателей — заказы с сайта хранят только HMAC-хеш (решение 132). Согласовано (решение 143) | `20260926122000_vendors_site_orders` |
| Таблица `recommendation_signals`, перечисление `ExperimentArm`, 2 CHECK | Контрольная группа и оценка прироста рекомендаций (решение 136). Согласовано, с правкой (решение 143: `recommendation_signals_outcome_check` — `outcome_at` и `outcome` только вместе, миграция `20260926200000_schema_review`) | `20260926000000_recommendation_signals` |
| Таблицы `telegram_updates_seen`, `system_secrets`, `approvals`, `idempotency_keys`; 5 колонок согласия у `contacts`/`contact_basis_history` | Безопасность, волна 2 (решение 133): дедуп апдейтов Telegram, ротация секрета вебхука, «четыре глаза» на опасные операции, идемпотентность POST. Согласовано, с правкой (решение 143: `approvals_decided_at_check` — `decided_at` согласован со статусом, миграция `20260926200000_schema_review`) | `20260926120000_security_wave_2` |
| Таблица `forecast_models`, перечисление `ForecastModelStatus` | Прогноз «дойдёт ли связка до вехи» (решение 135); `UNIQUE(milestone_stage)` — ровно одна (последняя) модель на веху. Согласовано (решение 143) | `20260926140000_forecast_models` |
| `users.notifications_seen_at` | Время последнего просмотра ленты уведомлений — источник истины на сервере, а не `localStorage` (решение 139). Согласовано (решение 143) | `20260926150000_notifications_seen_at` |

## Ревью схемы 26.09.2026 (решение 143)

Владелец решил согласовывать схему своими силами вместо внешнего согласования с Тиграном
(ветка `db/review-new-tables`). Ревью прошли все таблицы и колонки миграций
`20260925230000`–`20260926150000` (решения 109–139: версия сессий, ключ навыка, основание
ПД контактов, цепочка хешей журнала, DSAR, качество данных, обучение рекомендаций,
безопасность-2, вендоры и заказы, прогноз, эксперимент, уведомления) — по ключам, внешним
ключам и `ON DELETE`, индексам на месте фильтров и сортировок из `*.repo.ts`, уникальностям,
CHECK, `NOT NULL`, типам и именованию. Итог по каждой миграции:

| Миграция | Вердикт | Что исправлено |
| --- | --- | --- |
| `20260925230000_user_session_version` | Принято | — |
| `20260925230100_skill_name_key_unique` | Принято | — |
| `20260925230200_contact_legal_basis` | Принято | — |
| `20260926000000_audit_hash_chain` (решение 115) | Принято | — |
| `20260926000000_recommendation_signals` (решение 136) | Принято, с правкой | `recommendation_signals_outcome_check` — `outcome_at` и `outcome` заданы только вместе и не раньше `fired_at` (миграция `20260926200000_schema_review`) |
| `20260926011600_dsar_requests` (решение 116) | Принято | — |
| `20260926090000_data_quality` (решение 134) | Принято, с правкой | `university_merges_undone_check` сделан симметричным: `undone_at`/`undone_by_id` теперь или оба пустые, или оба заданы; в `db:verify` — правило «активное слияние согласовано с университетом-источником» |
| `20260926120000_recommendation_learning` (решение 119) | Принято, с правкой | `recommendation_rule_stats.eff_updated_at`: TIMESTAMPTZ(6) → TIMESTAMP(3) — единственная колонка с поясом в схеме, приведена к общему соглашению «пишем UTC»; в `db:verify` — правило «`scope_id` соответствует `scope_type`» |
| `20260926120000_security_wave_2` (решение 133) | Принято, с правкой | `approvals_decided_at_check` — `decided_at` пуст у REQUESTED, заполнен у APPROVED/REJECTED/CONSUMED |
| `20260926122000_vendors_site_orders` (решение 132) | Принято | — |
| `20260926140000_forecast_models` (решение 135) | Принято | `UNIQUE(milestone_stage)` уже держит «ровно одна модель на веху» — отдельного правила не потребовалось |
| `20260926150000_notifications_seen_at` (решение 139) | Принято | — |

Все правки — миграция `20260926200000_schema_review` (старые миграции не менялись). Она же
проверена на обеих версиях сида (`npm run db:seed` и `SEED_DQ_CASES=1 npm run db:seed`) и
обеих версиях `db:verify` (обычной и `--demo`) — без потери данных, без изменения существующих
строк, кроме типа одной колонки.

`deploy/yandex-cloud/create-app-role.sql` сверен со списком таблиц, защищённых от правки
триггером или самой сутью (`audit_log`, `audit_seals`, `audit_chain_cuts`, `contact_basis_history`,
`dsar_requests`) — права роли `skilllink_app` уже точно им соответствуют (проверено запуском
скрипта на копии базы: `INSERT, SELECT` на `audit_log`/`audit_seals`, только `SELECT` на
`audit_chain_cuts`, `INSERT, SELECT` на `contact_basis_history`, без `DELETE` на `dsar_requests`).
Изменений не потребовалось.

Не относится к решению 143 (общие открытые вопросы, не про эти миграции):

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
