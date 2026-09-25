# API_CONTRACT.md — контракт API SkillLink

Источник истины для фронта: P0 и серверная часть P1. Любое изменение поля фиксируется здесь
до правки кода.

Все описанные эндпоинты реализованы и проверены сквозным сценарием.

Базовый адрес локально: `http://localhost:3000`.

---


> **Windows.** В PowerShell `curl` — это псевдоним `Invoke-WebRequest` с другим
> синтаксисом: примеры ниже выдадут ошибку про несуществующий параметр. Пишите
> `curl.exe` — настоящий curl в Windows 10 и 11 есть. Одинарные кавычки вокруг
> JSON там тоже не работают: `-d "{\"name\":\"…\"}"`.

## 1. Общие правила

- JSON наружу — **camelCase**. В базе snake_case через `@map` / `@@map`.
  `TODO: PM DECISION` — подтвердить camelCase с фронтом.
- Даты — строка **ISO 8601 в UTC**: `"2026-09-21T07:24:47.059Z"`.
- Число дней (`daysToDeadline`, `daysToTarget`, `daysOverdue`) — календарные дни
  **по московским суткам**, как их показывает интерфейс. Ноль — тот же день,
  даже если срок уже прошёл по часам. До 23.09.2026 сутки считались по UTC,
  и с полуночи до трёх ночи по Москве число расходилось с датой на экране на день.
- Идентификаторы — строки (cuid), например `"cmuax8g450001v2rline15g0c"`.
- Все тексты ошибок — на русском.

### Формат успешного ответа

Один объект:

```json
{ "data": { "id": "…", "name": "…" } }
```

Список:

```json
{
  "data": [ { "id": "…" } ],
  "meta": { "page": 1, "pageSize": 20, "total": 137 }
}
```

Отдельные списки добавляют в `meta` свои поля — они описаны у соответствующего эндпоинта.

### Формат ошибки

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Ошибка валидации данных",
    "details": [ { "field": "name", "message": "Название должно содержать не менее 3 символов" } ]
  }
}
```

`details` присутствует не всегда. Для ошибок валидации это массив `{ field, message }`.

| Код | HTTP | Когда |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Не прошла проверка входных данных |
| `UNAUTHORIZED` | 401 | Пользователь не определён |
| `FORBIDDEN` | 403 | Роли не хватает прав |
| `NOT_FOUND` | 404 | Записи нет или она не видна пользователю |
| `CONFLICT` | 409 | Действие противоречит состоянию данных |
| `INVALID_TRANSITION` | 409 | Недопустимый переход статуса этапа |
| `INTEGRATION_ERROR` | 502 | Сбой внешнего сервиса |
| `INTERNAL` | 500 | Непредвиденная ошибка |

**Пределы базы проверяются на входе** (решение 52). Символ с кодом 0 в любом тексте
тела или параметров запроса — `VALIDATION_ERROR` с именем поля, в пути — `NOT_FOUND`:
PostgreSQL такой символ не принимает. Количества (студенты, группы, заявки,
направления) — не больше 2 147 483 647, сколько вмещает колонка `Int`.
Раньше и то и другое доходило до базы и отвечало `INTERNAL`.

**API вызывается из браузера**, из клиентских компонентов: браузер сам отправляет
cookie пользователя. Серверные компоненты Next к API не обращаются. Запрос с сервера
уходит от имени процесса и не несёт cookie: в демо-режиме API подставит пользователя
по умолчанию и страница покажет чужие данные, в промышленном — вернёт `401`.
Если такой вызов понадобится, cookie входящего запроса нужно передать явно.

**Несуществующий адрес API** тоже отвечает JSON, а не HTML-страницей:
`404` с `code: "NOT_FOUND"`. Так опечатка в пути выглядит как обычная ошибка API,
а не как `Unexpected token '<'` при разборе ответа.

Запись чужого вуза для роли `UNIVERSITY_REP` возвращает **404, а не 403**: существование записи
не раскрывается.

### Авторизация

Аутентификация — NextAuth.js с сессиями на JWT, пароли хранятся хешами bcrypt.

**Вход.** Фронт вызывает `signIn('credentials', { email, password })` из `next-auth/react`.
Напрямую по HTTP: `GET /api/auth/csrf` → `POST /api/auth/callback/credentials` формой
(`csrfToken`, `email`, `password`). Выход — `POST /api/auth/signout` с `csrfToken`.
Текущая сессия — `GET /api/auth/session` (без сессии возвращается `null`).

**Отказ во входе — три кода**, приходят в `code` ответа `signIn` (или в адресе
перенаправления `?error=CredentialsSignin&code=…`):

| `code` | Что показать |
| --- | --- |
| `credentials` | «Неверная почта или пароль». Какое из двух — не говорится намеренно |
| `too_many_attempts` | «Слишком много попыток. Вход закрыт на 15 минут». После пяти неудач подряд — **даже с верным паролем**. Без этого сообщения человек решит, что забыл пароль |
| `captcha_required` | Нужна проверка «не робот» (с 25.09.2026, решение 100). Пароль не проверялся, неудача не засчитана. Взять задачу `GET /api/login-challenge`, решить и повторить вход с полем `captcha` |

**Проверка «не робот».** После трёх неудач подряд по учётной записи с одного адреса
(или десяти по ней со всех адресов за час) вход ждёт решённую задачу: поле формы `captcha`
— строка JSON `{ algorithm, challenge, salt, number, signature }`. Задача — найти число
от 0 до `maxNumber`, при котором SHA-256 от `salt + число` (шестнадцатеричный) равен
`challenge`; браузер решает её сам за доли секунды — секунду-две. Решение действует
один раз и живёт 5 минут. Удачный вход снимает требование. Закрытый вход проверку
не просит — сразу `too_many_attempts`. Значения — TEMP в `LOGIN_CAPTCHA`.

Пять неудач считаются для пары «учётная запись + адрес клиента» (с 25.09.2026; раньше —
для учётной записи с любых адресов, и посторонний закрывал вход владельцу). Кроме того,
тот же код приходит после 20 неудач с одного адреса по любым учётным записям за 5 минут
и после 50 неудач по одной учётной записи со всех адресов за час. Значения — TEMP
в `src/shared/config/auth.config.ts`.

**Изменяющие запросы с чужого сайта** (`POST`, `PUT`, `PATCH`, `DELETE` с заголовком
`Origin`, который не совпадает с `AUTH_URL` или хостом запроса) получают `FORBIDDEN` 403
«Запрос пришёл с другого сайта и отклонён» (с 25.09.2026). Запрос без `Origin` — скрипты,
curl — не затрагивается. `/api/auth/*` не затрагивается.

**Срок сессии** — 8 часов с момента входа (с 25.09.2026; раньше 30 дней).

Пространство `/api/auth/*` целиком принадлежит NextAuth. Сведения о текущем пользователе
системы отдаёт **`GET /api/me`**.

**Демо-режим.** Пока включён `DEMO_AUTH_ENABLED` (по умолчанию везде, кроме продакшена),
дополнительно работает переключение пользователя без пароля: cookie `skilllink_user` со
значением идентификатора; без неё берётся первый активный сотрудник в порядке
MANAGER → ADMIN → ANALYST → VIEWER.

Настоящая сессия всегда **важнее** демо-cookie: подменить пользователя подстановкой cookie
при активной сессии нельзя.

При `DEMO_AUTH_ENABLED=false` запрос без сессии получает `UNAUTHORIZED` 401.

| Право | Роли |
| --- | --- |
| `READ` | ADMIN, MANAGER, ANALYST, VIEWER, UNIVERSITY_REP |
| `WRITE` | ADMIN, MANAGER |
| `ANALYTICS` | ADMIN, MANAGER, ANALYST, VIEWER |
| `ANALYTICS_WORK` | ADMIN, MANAGER, ANALYST — пересобрать рекомендации, вести их статусы, загрузить рыночные данные (решение 98) |
| `ADMIN` | ADMIN |
| `UNIVERSITY_PORTAL` | ADMIN, MANAGER, UNIVERSITY_REP — просмотр кабинета вуза |
| `UNIVERSITY_PORTAL_WRITE` | UNIVERSITY_REP — запись в кабинете: подтверждение материалов, показатели, заявки |
| `CONTACT_DETAILS` | ADMIN, MANAGER — почта и телефон контактных лиц вузов (решение 106); UNIVERSITY_REP — только контактов своего вуза |

**Почта и телефон контактных лиц вузов** (с 25.09.2026, решение владельца, решение 106):

| Где | ADMIN, MANAGER | ANALYST, VIEWER | UNIVERSITY_REP |
| --- | --- | --- | --- |
| Карточка вуза `GET /api/universities/:id` (`contacts`, `primaryContact`) | почта и телефон | ФИО и должность; `email`, `phone` = `null`, `contactDetailsHidden: true` | свой вуз — почта и телефон; чужой — `NOT_FOUND` |
| Ответы `POST/PATCH /api/universities…`, обезличивание | почта и телефон | — (нет права) | — (нет права) |
| Реестр `GET /api/universities?q=` и поиск `GET /api/search` | по почте и телефону контакта не ищут ни для кого | то же | то же |
| Выгрузка вузов `GET /api/export?dataset=universities` | почта основного контакта, телефона нет | почта пустая | почта пустая |
| Встречи (участник-контакт), документы (подстановка контакта) | только ФИО и должность | то же | то же |
| ИИ-помощник | почта и телефон вырезаются из текста до отправки модели | то же | — |
| `GET /api/me` → `permissions.canSeeContactDetails` | `true` | `false` | `false` (признак «скрыто» — в самом контакте) |

**Ответственным** за связку, этап, встречу и документ назначается только действующий
ADMIN или MANAGER (с 25.09.2026; раньше — любой сотрудник, включая ANALYST и VIEWER).
Иначе — `VALIDATION_ERROR` 422 по полю `responsibleId`: «Ответственным может быть только
менеджер или администратор ИТ-Школы»; несуществующий — «Сотрудник не найден».

### Пагинация, фильтры, сортировка

- `page` — с 1, по умолчанию 1.
- `pageSize` — 1..100, по умолчанию 20.
- `sort` — имя поля; минус спереди означает убывание: `sort=-updatedAt`.
- При равном значении поля порядок задаёт `id`, поэтому страницы не повторяют
  и не теряют строки. Без этого ключа обход по страницам терял до шести строк
  из сорока (решение 45).
- Повторяющийся параметр собирается в массив: `?status=ACTIVE&status=NEW`.
- `q` — подстрока без учёта регистра. Знаки `%` и `_` ищутся как обычные символы:
  до 23.09.2026 они работали как подстановочные знаки SQL, и поиск «_» находил всё.
- Пустое значение параметра игнорируется.

### Признак демонстрационных данных

Каждая запись и каждый аналитический ответ несут `isMock`. **Фронт обязан показывать пометку**:
выдавать демо-данные за подтверждённую статистику запрещено (раздел 4 ТЗ).

### Показатели и «Нет данных»

Числовой показатель приходит объектом:

```json
{
  "value": 310,
  "unit": "заявки",
  "basis": "estimate",
  "explanation": "Заявки на обучение: 310 (демонстрационные данные)",
  "period": "2026-09-07T10:00:00.000Z",
  "source": "MOCK",
  "isMock": true
}
```

`basis`: `actual` — фактические данные, `estimate` — оценка, `none` — данных нет.
При `basis: "none"` поле `value` равно **null**. Ноль никогда не подставляется вместо отсутствия
данных — фронт показывает «Нет данных».

---

## 2. Служебное

### GET /api/login-challenge

Задача для проверки «не робот» на входе (решение 100). Авторизация не требуется,
ответ не кэшируется: каждый запрос получает новую задачу.

```json
{ "data": { "algorithm": "SHA-256", "challenge": "9f86d0…", "salt": "3c1e…a7.1790000000000.",
            "maxNumber": 100000, "signature": "5b2a…" } }
```

Решение уходит полем `captcha` формы входа — см. «Проверка «не робот»» в разделе
«Авторизация».

### GET /api/health

Проверка живости приложения. Авторизация не требуется.

Проверяется не только соединение, но и то, что миграции применены: пустая база отвечает
на `SELECT 1` как ни в чём не бывало, и контейнер рапортовал бы «здоров», пока приложение
на деле неработоспособно.

```bash
curl -s http://localhost:3000/api/health
```

```json
{ "data": { "status": "ok", "database": "connected", "schema": "ready",
            "time": "2026-09-21T07:24:47.059Z" } }
```

Если миграции не применены — **503** и подсказка:

```json
{ "data": { "status": "degraded", "database": "connected", "schema": "missing",
            "hint": "Примените миграции: npm run db:deploy", "time": "…" } }
```

Поле `database` называет причину, а не просто «не работает»:

| `database` | Когда | `status` |
| --- | --- | --- |
| `connected` | база отвечает | `ok`, либо `degraded`, если не применены миграции |
| `unreachable` | сервер не отвечает: не запущен, не тот адрес или порт | `degraded` |
| `auth-failed` | база отвергла пароль. `POSTGRES_PASSWORD` меняет пароль только при создании базы — существующему тому он ничего не меняет | `degraded` |
| `database-missing` | сервер отвечает, но базы с таким именем нет | `degraded` |
| `not-configured` | не задан `DATABASE_URL` | `misconfigured` |
| `unknown` | до базы не дошло: не задан `AUTH_SECRET` в промышленном режиме | `misconfigured` |

Полная ошибка пишется в журнал приложения (`docker compose logs app`): подсказка
отвечает на «что делать», а разбираться в неожиданном сбое нужно по ней.

**В продакшене (`NODE_ENV=production`) подробностей нет** (с 25.09.2026): поля `hint` нет,
`database` — только `connected`, `unknown` или `unavailable`, `status` — `ok` или `degraded`
(вместо `misconfigured`). Подсказка пишется в журнал приложения. `status` и `schema`
значат то же, что и вне продакшена: на них смотрят `scripts/deploy/check.sh` и Docker.

---

## 3. Университеты

### GET /api/universities

Право: `READ`. Реестр вузов (раздел 7.2 ТЗ).

| Параметр | Тип | Описание |
| --- | --- | --- |
| `page`, `pageSize` | number | Пагинация |
| `q` | string | Поиск по названию, краткому названию, городу, региону и названиям программ |
| `status` | enum[] | `NEW`, `IN_PROGRESS`, `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `region` | string[] | Точное совпадение региона |
| `city` | string[] | Точное совпадение города |
| `sort` | string | `name`, `city`, `region`, `status`, `createdAt`, `updatedAt`, `rating` (по умолчанию `name`) |
| `includeArchived` | `true`/`false` | По умолчанию архивные скрыты |
| `withRating` | `true`/`false` | Рейтинг приходит **по умолчанию**. `false` отключает расчёт |
| `minRating`, `maxRating` | number 0..100 | Отбор по рейтингу вуза (пункт 7.2 ТЗ) |

**Рейтинг вуза** приходит в каждой строке без дополнительных параметров.
`withRating=false` отключает расчёт: это отдельный проход по показателям всех программ,
и там, где реестр открывают ради выбора из списка, платить за него незачем.

Требует права `ANALYTICS`. Представителю вуза:

- **явный** запрос рейтинга (`withRating=true`, `minRating`, `maxRating`, `sort=rating`)
  — `403`;
- обычный список открывается как раньше, но `rating` в нём `null`.

Так сделано потому, что по порядку выдачи и границам фильтра можно восстановить баллы
чужих вузов, ни одного не увидев.

Отбор `minRating`/`maxRating` отсекает вузы без рассчитанного балла: `minRating=0`
означает «есть рейтинг», а не «любой вуз». При `sort=rating` вузы без балла уходят
в конец при обоих направлениях — «Нет данных» не участвует в ранжировании (решение 8).

```bash
curl -s "http://localhost:3000/api/universities?q=связи&status=ACTIVE&pageSize=10"
```

Элемент списка (`UniversityListItemDto`):

```json
{
  "id": "cmuax8g4t0008v2rl4bg3v2kn",
  "name": "Санкт-Петербургский государственный университет телекоммуникаций",
  "shortName": "СПбГУТ",
  "city": "Санкт-Петербург",
  "region": "Санкт-Петербург",
  "status": "ACTIVE",
  "programCount": 2,
  "cooperationCount": 2,
  "activeCooperationCount": 2,
  "isMock": true,
  "rating": { "score": 82.1, "basis": "estimate", "…": "см. ниже" },
  "updatedAt": "2026-09-21T07:23:11.101Z",
  "archivedAt": null
}
```

Поле `rating` целиком (`UniversityRatingDto`). `null` — только если рейтинг отключён
параметром или роль его не видит:

```json
{
  "universityId": "cmuax8g4t0008v2rl4bg3v2kn",
  "score": 82.1,
  "basis": "estimate",
  "explanation": "Балл вуза — среднее по программам; учтено 2 из 2 программ, показатели нормированы внутри всей выборки программ",
  "programCount": 2,
  "ratedProgramCount": 2,
  "topProgram": { "programId": "…", "name": "Программная инженерия", "score": 100 }
}
```

`score: null` — «Нет данных», показывать как «Нет данных», а не 0 (решение 8).
`topProgram` раскрывает балл: это сильнейшая программа вуза.

### GET /api/universities/:id

Право: `READ`. Карточка вуза (раздел 7.3 ТЗ). Ошибка: `NOT_FOUND`.

Рейтинг в карточке считается **всегда** и параметра не требует: карточка — то место,
где балл нужно раскрыть сильнейшей программой. Представителю вуза приходит `null`.

Дополнительно к полям списка (`UniversityDto`):

```json
{
  "address": "Санкт-Петербург, адрес указан условно",
  "website": "https://example.invalid/spbgu",
  "description": "Демонстрационная запись…",
  "directionCount": 24,
  "studentCount": 11800,
  "primaryContact": {
    "id": "…", "fullName": "Ветрова Ирина Павловна",
    "position": "Заместитель декана",
    "email": "contact@spbgu.example.invalid", "phone": "+7 900 000-00-00", "isPrimary": true,
    "isAnonymized": false, "contactDetailsHidden": false
  },
  "contacts": [ "…" ],
  "createdAt": "2026-09-21T07:23:11.101Z"
}
```

**Почта и телефон контактов** (решение 106) — только ADMIN и MANAGER, представителю вуза —
своего вуза. ANALYST и VIEWER получают ФИО и должность, а `email` и `phone` — `null`
с `contactDetailsHidden: true`: фронт пишет «скрыто — доступно менеджеру», а не «не указано».
Значения скрываются в сервисе, в ответ не попадают. У обезличенного контакта
`contactDetailsHidden: false` — там данных нет ни у кого.

```json
{ "id": "…", "fullName": "Ветрова Ирина Павловна", "position": "Заместитель декана",
  "email": null, "phone": null, "isPrimary": true,
  "isAnonymized": false, "contactDetailsHidden": true }
```

### POST /api/universities

Право: `WRITE`. Ответ 201.

| Поле | Тип | Обязательно | Ограничения |
| --- | --- | --- | --- |
| `name` | string | да | 3..300 |
| `city` | string | да | 2..120 |
| `region` | string | да | 2..120 |
| `shortName` | string \| null | нет | до 100 |
| `address` | string \| null | нет | до 300 |
| `website` | string \| null | нет | ссылка `http://` или `https://`, до 2000 символов |
| `status` | enum | нет | по умолчанию `NEW` |
| `directionCount` | number \| null | нет | ≥ 0 |
| `studentCount` | number \| null | нет | ≥ 0 |
| `description` | string \| null | нет | до 2000 |
| `contacts` | array | нет | до 20, поля `fullName` (обяз.), `position`, `email`, `phone`, `isPrimary` |

```bash
curl -s -X POST http://localhost:3000/api/universities \
  -H 'content-type: application/json' \
  -d '{"name":"Проверочный университет связи","city":"Тверь","region":"Тверская область","status":"IN_PROGRESS"}'
```

### PATCH /api/universities/:id

Право: `WRITE`. Любое подмножество полей создания, кроме `contacts`. **Пустое тело — 422.**
Архивную запись править нельзя — `CONFLICT`.

### POST /api/universities/:id/archive

Право: `WRITE`. Архивирование вместо удаления. Если есть связки в статусах `DRAFT`, `ACTIVE`,
`PAUSED` — `CONFLICT` с `details.openCooperations`.

### POST /api/universities/:id/restore

Право: `WRITE`. Возвращает вуз из архива в статус `IN_PROGRESS`.

### POST /api/universities/:id/contacts/:contactId/anonymize

Право: `ADMIN`. Обезличивание контактного лица вуза — исполнение права субъекта на удаление
персональных данных (docs/PRIVACY.md, решение 88). ФИО заменяется на «Контакт удалён»,
должность, почта, телефон и заметки стираются, признак основного снимается. Запись остаётся:
на неё ссылаются участники встреч. Необратимо; повтор ничего не меняет и отвечает тем же.
Чужой вуз или чужой контакт — `NOT_FOUND`. В журнал — `contact.anonymize` без ФИО
и прежних значений. Ответ — контакт с `isAnonymized: true`.

---

## 4. Образовательные программы

### GET /api/programs

Право: `READ`.

| Параметр | Тип | Описание |
| --- | --- | --- |
| `q` | string | Поиск по названию, коду, направлению, названию вуза |
| `universityId` | string | Программы одного вуза |
| `level` | enum[] | `SPO`, `BACHELOR`, `SPECIALIST`, `MASTER`, `POSTGRADUATE`, `DPO` |
| `status` | enum[] | `DRAFT`, `ACTIVE`, `SUSPENDED`, `ARCHIVED` |
| `skillId` | string[] | Программы, где есть любой из навыков |
| `sort` | string | `name`, `level`, `status`, `applicationCount`, `studentCount`, `groupCount`, `createdAt`, `updatedAt` |
| `includeArchived` | `true`/`false` | По умолчанию архивные скрыты |

При сортировке по показателю набора записи без данных уходят в конец списка.

```bash
curl -s "http://localhost:3000/api/programs?level=MASTER&sort=-applicationCount"
```

`ProgramListItemDto`:

```json
{
  "id": "…",
  "universityId": "…",
  "universityName": "МТУСИ",
  "name": "Облачные технологии и инфраструктура",
  "code": "09.04.01",
  "direction": "Информатика и вычислительная техника",
  "level": "MASTER",
  "durationMonths": 24,
  "status": "ACTIVE",
  "metrics": {
    "applicationCount": { "value": 190, "unit": "заявки", "basis": "estimate", "explanation": "…", "source": "MOCK", "period": "…", "isMock": true },
    "studentCount":     { "value": 76,  "unit": "человек", "basis": "estimate", "explanation": "…", "source": "MOCK", "period": "…", "isMock": true },
    "groupCount":       { "value": 3,   "unit": "групп",   "basis": "estimate", "explanation": "…", "source": "MOCK", "period": "…", "isMock": true }
  },
  "skillCount": 3,
  "cooperationCount": 1,
  "isMock": true,
  "updatedAt": "…"
}
```

`universityShortName` — краткое название вуза, `null`, если его нет. Добавлено 23.09.2026
для плотных таблиц, как и у связок. Поле новое, прежние поля не менялись.

### GET /api/programs/:id

Право: `READ`. Дополнительно `skills[]`, `createdAt`, `archivedAt` и **`rating`** —
балл для заголовка карточки.

Шкала та же, что в `GET /api/analytics/programs`, поэтому балл в карточке совпадает
с рейтингом. `rating: null` — рейтинг недоступен роли (представитель вуза видит
карточку, но не аналитику). `rating.score: null` — «Нет данных» или программа
не действует; причина — в `rating.explanation`.

```json
{
  "rating": {
    "programId": "…", "score": 79.1, "basis": "estimate",
    "explanation": "…", "factors": [ { "key": "applicationCount", "value": 420, "…": "…" } ]
  }
}
```

```json
{
  "skills": [
    {
      "skillId": "…", "name": "Облачные платформы", "category": "Инфраструктура",
      "level": "ADVANCED", "importance": "CRITICAL",
      "source": "CURRICULUM", "confidence": "MEDIUM", "comment": null
    }
  ]
}
```

### POST /api/programs

Право: `WRITE`. Ответ 201.

| Поле | Тип | Обязательно |
| --- | --- | --- |
| `universityId` | string | да |
| `name` | string | да (3..300) |
| `level` | enum | да |
| `code`, `direction` | string \| null | нет |
| `durationMonths` | number \| null | нет (1..120) |
| `status` | enum | нет, по умолчанию `ACTIVE` |
| `applicationCount`, `studentCount`, `groupCount` | number \| null | нет, ≥ 0. **null означает «Нет данных»** |
| `metricsSource` | enum \| null | нет; если показатели переданы без источника, проставляется `MANUAL` |

Ошибки: `VALIDATION_ERROR` — вуза нет или он в архиве.

### PATCH /api/programs/:id

Право: `WRITE`. Подмножество полей, кроме `universityId`. Пустое тело — 422.
При изменении любого показателя набора обновляются `metricsSource` и `metricsUpdatedAt`.

### PUT /api/programs/:id/skills

Право: `WRITE`. **Полная замена** набора навыков программы.

```bash
curl -s -X PUT http://localhost:3000/api/programs/PROGRAM_ID/skills \
  -H 'content-type: application/json' \
  -d '{"skills":[{"skillId":"SKILL_ID","level":"ADVANCED","importance":"CRITICAL"}]}'
```

| Поле элемента | По умолчанию |
| --- | --- |
| `skillId` | обязательно |
| `level` | `BASIC` |
| `importance` | `MEDIUM` |
| `source` | `CURRICULUM` |
| `confidence` | null |
| `comment` | null |

`{"skills": []}` снимает все навыки. Ошибки: `VALIDATION_ERROR` при повторе навыка или
несуществующем `skillId`.

### POST /api/programs/:id/archive

Право: `WRITE`. Архивная программа скрыта из списков; показать её можно
параметром `includeArchived=true`.

### POST /api/programs/:id/restore

Право: `WRITE`. Возврат программы из архива в статус `ACTIVE`.
Отклоняется, если вуз программы находится в архиве.

---

## 5. Навыки и рынок

### GET /api/skills

Право: `READ`. Параметры: `q`, `category[]`, `sort` (`name`, `category`, `createdAt`), пагинация.

```json
{ "id": "…", "name": "Kubernetes", "category": "DevOps", "description": "Оркестрация контейнеров",
  "programCount": 0, "productCount": 1 }
```

### GET /api/skills/demand

**Это сводка, а не постраничный список.** Параметр `limit` ограничивает размер выдачи,
`page` и `pageSize` здесь не работают. В `meta`:

| Поле | Что значит |
| --- | --- |
| `total` | сколько найдено **всего**, до обрезания по `limit` |
| `pageSize` | сколько строк отдано в этом ответе |
| `truncated` | `true`, если выдача обрезана |

По ним интерфейс может честно сказать «показаны 50 из 180» и предложить увеличить
выборку. `total` намеренно считается до обрезания: инструмент, который существует ради
показа дефицитов, не должен занижать их число из-за размера страницы.

Право: `ANALYTICS`. Востребованность навыков на рынке.

| Параметр | Описание |
| --- | --- |
| `period` | `2026-Q1` или `2026-03`. По умолчанию — последний доступный период |
| `region` | Регион выборки |
| `category` | string[] |
| `skillId` | string[] |
| `limit` | 1..200, по умолчанию 50 |

```bash
curl -s "http://localhost:3000/api/skills/demand?period=2026-Q1&limit=5"
```

```json
{
  "data": [
    {
      "skillId": "…", "name": "SQL", "category": "Базы данных",
      "period": "2026-Q1", "value": 9600, "unit": "вакансий",
      "normalized": 1, "region": "Россия",
      "source": "Демонстрационный набор вакансий", "confidence": "LOW", "isMock": true
    }
  ],
  "meta": { "page": 1, "pageSize": 5, "total": 5, "period": "2026-Q1", "isMock": true }
}
```

`normalized` — спрос, приведённый к 0..1 по **всей** выборке периода, а не по отфильтрованной
странице: иначе значения нельзя было бы сравнивать между запросами с разными фильтрами.

### GET /api/skills/gaps

**Это сводка, а не постраничный список.** Параметр `limit` ограничивает размер выдачи,
`page` и `pageSize` здесь не работают. В `meta`:

| Поле | Что значит |
| --- | --- |
| `total` | сколько найдено **всего**, до обрезания по `limit` |
| `pageSize` | сколько строк отдано в этом ответе |
| `truncated` | `true`, если выдача обрезана |

По ним интерфейс может честно сказать «показаны 50 из 180» и предложить увеличить
выборку. `total` намеренно считается до обрезания: инструмент, который существует ради
показа дефицитов, не должен занижать их число из-за размера страницы.

Право: `ANALYTICS`. Дефицит навыков.

| Параметр | Описание |
| --- | --- |
| `programId` | Дефициты одной программы |
| `universityId` | Сводка по программам одного вуза |
| `period` | По умолчанию последний доступный |
| `criticalOnly` | `true` — только критичные |
| `limit` | 1..200, по умолчанию 50 |

Без `programId` и `universityId` считается сводка по всем активным программам.

```json
{
  "data": [
    {
      "skillId": "…", "name": "Kubernetes", "category": "DevOps",
      "demand": 7900, "demandNormalized": 0.77,
      "coverage": 0, "level": null, "importance": null,
      "gap": 0.77, "isCritical": true,
      "explanation": "Навык «Kubernetes» востребован рынком (77 из 100), но в программе отсутствует",
      "outOfProfile": false,
      "isMock": true
    }
  ],
  "meta": { "page": 1, "pageSize": 18, "total": 18, "period": "2026-Q1", "programId": null, "isMock": true }
}
```

**Вне профиля** (`outOfProfile`, решение 98) — только с `programId`. Непокрытый навык вне
профиля программы, если ни одна действующая программа той же укрупнённой группы
направлений (первые две цифры кода: «09» у «09.03.04») не преподаёт ни его, ни — кроме
языков программирования — навыки той же категории. Такой дефицит не критический
(`isCritical: false`), идёт после остальных и получает в `explanation` пояснение
«Вне профиля: …». У программы без кода направления пометки нет. Правило — TEMP
(`SKILL_PROFILE`), до профиля направления, который задаётся вручную.

---

## 6. IT-продукты

### GET /api/products

Право: `READ`. Параметры: `q`, `category[]`, `status[]` (`PLANNED`, `ACTIVE`, `DEPRECATED`),
`skillId[]`, `sort` (`name`, `category`, `status`, `updatedAt`), пагинация.

### GET /api/products/:id

Право: `READ`. Дополнительно `description` и `skills[]` с полем
`relevance` (`CORE`, `RELATED`, `OPTIONAL`).

### POST /api/products

Право: `WRITE` (представителю вуза, аналитику и наблюдателю — 403). Ответ 201 —
карточка продукта, как у `GET /api/products/:id`. Заведённый вручную продукт
не демонстрационный: `isMock: false`.

| Поле | Тип | Обязательно | Ограничения |
| --- | --- | --- | --- |
| `name` | string | да | 2..200, **уникально без учёта регистра** |
| `category` | string | да | 2..100 |
| `description` | string \| null | нет | до 2000 |
| `documentationUrl` | string \| null | нет | только `http://` или `https://`, до 500 |
| `version` | string \| null | нет | 1..50 |
| `status` | enum | нет | `PLANNED`, `ACTIVE`, `DEPRECATED`; по умолчанию `ACTIVE` |

```bash
curl -s -X POST http://localhost:3000/api/products \
  -H 'content-type: application/json' \
  -d '{"name":"Платформа видеоконференций","category":"Коммуникации","version":"1.0","documentationUrl":"https://example.invalid/docs"}'
```

Ошибки:

- `CONFLICT` 409 — продукт с таким названием уже есть (регистр не важен).
  `details: [{ "field": "name", "message": "Продукт с таким названием уже есть" }]`,
  текст: «IT-продукт «…» уже есть в реестре. Выберите другое название.»
- `VALIDATION_ERROR` 422 — например, `documentationUrl` вида `javascript:…` или `ftp://…`.

### PATCH /api/products/:id

Право: `WRITE`. Любое подмножество полей создания. **Пустое тело — 422.**
Ответ — карточка продукта.

- Дубль названия — `CONFLICT`, как при создании. Своё же название в другом регистре — не дубль.
- **Версию продукта с открытыми связками (`DRAFT`, `ACTIVE`, `PAUSED`) правкой не поменять** —
  `CONFLICT` с `details: [{ "field": "version", … }]`. Новая версия передаётся вузам выпуском
  версии (`POST /api/products/:id/release`, раздел 15в): он ставит задачи и переоткрывает этап
  обновления материалов. Тихая правка оставила бы этап закрытым со старыми материалами.
  У продукта без открытых связок версию можно исправить здесь.

```bash
curl -s -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H 'content-type: application/json' \
  -d '{"status":"DEPRECATED","description":"Выводится из эксплуатации"}'
```

### PUT /api/products/:id/skills

Право: `WRITE`. **Полная замена** набора навыков продукта — как `PUT /api/programs/:id/skills`.

```bash
curl -s -X PUT http://localhost:3000/api/products/PRODUCT_ID/skills \
  -H 'content-type: application/json' \
  -d '{"skills":[{"skillId":"SKILL_ID","relevance":"CORE"}]}'
```

| Поле элемента | По умолчанию |
| --- | --- |
| `skillId` | обязательно |
| `relevance` | `RELATED` (`CORE`, `RELATED`, `OPTIONAL`) |

`{"skills": []}` снимает все навыки. Ошибки: `VALIDATION_ERROR` при повторе навыка или
несуществующем `skillId`.

Все три записи попадают в журнал действий: `product.create`, `product.update`,
`product.skills.replace` (в журнале — имена изменённых полей, не значения).

---

## 7. Сотрудничество

### GET /api/cooperations

Право: `READ`.

| Параметр | Описание |
| --- | --- |
| `q` | Поиск по словам: каждое слово найдено хотя бы в одном поле — полное или краткое имя вуза, программа, продукт, цель, ФИО ответственного. Без учёта регистра, не больше 6 слов |
| `universityId`, `programId`, `productId`, `responsibleId` | Точные фильтры |
| `status` | enum[]: `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED` |
| `onlyOverdue` | `true` — только связки с просроченными этапами (этап в работе или заблокирован, срок прошёл) |
| `onlyBlocked` | `true` — только связки с заблокированными этапами |
| `sort` | `status`, `createdAt`, `updatedAt`, `targetDate`, `classesStartAt` |

`CooperationListItemDto`:

```json
{
  "id": "…",
  "universityId": "…",
  "universityName": "Санкт-Петербургский государственный университет телекоммуникаций",
  "universityShortName": "СПбГУТ",
  "programId": "…",    "programName": "Информационная безопасность…",
  "productId": "…",    "productName": "Система мониторинга безопасности",
  "status": "ACTIVE",
  "responsible": { "id": "…", "fullName": "Кириллов Пётр Андреевич", "role": "MANAGER" },
  "currentStage": {
    "id": "…", "stageNumber": 10, "title": "Обновление образовательной программы",
    "phase": "IMPLEMENTATION", "status": "IN_PROGRESS",
    "deadline": "2026-10-15T00:00:00.000Z", "isOverdue": false, "isPlanShifted": false, "isDueSoon": false,
    "daysToDeadline": 22
  },
  "progress": {
    "percent": 69, "completedStages": 9, "cancelledStages": 0,
    "totalStages": 13, "overdueStages": 0, "blockedStages": 0
  },
  "targetDate": "2026-10-21T07:23:11.101Z",
  "classesStartAt": "2026-10-21T07:23:11.101Z",
  "daysToTarget": 30,
  "isMock": true,
  "updatedAt": "…"
}
```

`currentStage.daysToDeadline` — дней до срока текущего этапа, отрицательное — просрочка,
`null`, если срока нет. Добавлено 23.09.2026: до этого интерфейс показывал у текущего этапа
«просрочен на N дн.», подставляя `daysToTarget` — дни до контрольной даты всей связки,
то есть число не про этап.

`universityShortName` — краткое название вуза, `null`, если его нет. Добавлено 23.09.2026
для плотных таблиц: полное название обрезается на первом слове, краткое читается целиком.
Поле новое, старые поля не менялись — существующие клиенты его просто не заметят.

`progress.totalStages` равно **13**: контрольный этап 14 в процент не входит — он лишь отражает
состояние остальных. `currentStage` — первый по номеру этап, который не `COMPLETED` и не
`CANCELLED`; контрольный этап туда не попадает. `null`, если закрыты все этапы.

### GET /api/cooperations/:id

Право: `READ`. Дополнительно `goal`, `notes`, `firstContactAt`, `startedAt`, `closedAt`,
`createdAt` и полный массив `stages[]` (см. раздел 8).

### POST /api/cooperations

Право: `WRITE`. Ответ 201. **Создаёт все 14 этапов с чек-листами и нормативными сроками.**

| Поле | Тип | Обязательно |
| --- | --- | --- |
| `universityId` | string | да |
| `programId` | string | да |
| `responsibleId` | string | да |
| `productId` | string \| null | нет — продукт может быть не выбран |
| `status` | enum | нет, по умолчанию `DRAFT` |
| `goal`, `notes` | string \| null | нет |
| `firstContactAt`, `classesStartAt`, `targetDate` | ISO 8601 \| null | нет |

```bash
curl -s -X POST http://localhost:3000/api/cooperations \
  -H 'content-type: application/json' \
  -d '{"universityId":"UNI_ID","programId":"PROG_ID","productId":"PROD_ID","responsibleId":"USER_ID","goal":"Внедрение продукта в учебный процесс"}'
```

Ошибки `VALIDATION_ERROR`: программы нет, программа в архиве, программа принадлежит другому вузу,
ответственный не найден, продукт не найден.

**Одна незакрытая связка на «вуз + программа + IT-продукт».** Если такая уже есть в статусе
`DRAFT`, `ACTIVE` или `PAUSED` (продукт «не выбран» — тоже значение), ответ `CONFLICT` 409,
в `details.cooperationId` — существующая связка:

```json
{ "error": { "code": "CONFLICT",
             "message": "Такая связка уже есть: СПбГУТ — Информационная безопасность, статус «В работе»",
             "details": { "cooperationId": "…" } } }
```

Закрытые (`COMPLETED`, `CANCELLED`) не мешают: сотрудничество можно начать заново.
Проверка и создание идут одной транзакцией в очереди программы — два одновременных
запроса не заведут двух одинаковых связок.

### PATCH /api/cooperations/:id

Право: `WRITE`. Поля: `productId`, `responsibleId`, `status`, `goal`, `notes`, `firstContactAt`,
`classesStartAt`, `targetDate`. Пустое тело — 422. Закрытую связку (`COMPLETED`, `CANCELLED`)
править нельзя, кроме смены статуса — `CONFLICT`. `productId: null` отвязывает продукт.
Смена продукта и переоткрытие подчиняются тому же правилу, что создание: если получится
вторая незакрытая связка «вуз + программа + продукт» — `CONFLICT` с `details.cooperationId`.

---

## 8. Workflow: 14 этапов

### GET /api/cooperations/:id/stages

Право: `READ`. Массив `WorkflowStageDto`, отсортированный по `stageNumber`.

```json
{
  "id": "…",
  "cooperationId": "…",
  "stageNumber": 1,
  "title": "Поиск контакта ответственного лица в вузе",
  "phase": "ATTRACTION",
  "status": "COMPLETED",
  "responsible": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "deadline": "2026-09-28T07:23:11.101Z",
  "isOverdue": false,
  "isPlanShifted": false,
  "daysToDeadline": 7,
  "comment": null,
  "result": "Контакт найден, договорённость о встрече достигнута",
  "blockingReason": null,
  "startedAt": "…", "completedAt": "…",
  "completedBy": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "isAutoManaged": false,
  "tasks": [
    { "id": "…", "title": "Найден ответственный сотрудник вуза", "isRequired": true,
      "isDone": true, "doneAt": "…", "doneBy": { "id": "…", "fullName": "…", "role": "MANAGER" },
      "sortOrder": 0 }
  ],
  "requiredTasksTotal": 2,
  "requiredTasksDone": 2,
  "updatedAt": "…"
}
```

`phase`: `ATTRACTION` (этапы 1–3), `FORMALIZATION` (4–6), `IMPLEMENTATION` (7–10),
`OPERATION` (11–13), `CONTROL` (14).

`isAutoManaged: true` только у этапа 14. Фронт должен показывать его только для чтения.

### PATCH /api/workflow/stages/:id

Право: `WRITE`.

| Поле | Тип |
| --- | --- |
| `status` | enum: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`, `CANCELLED` |
| `responsibleId` | string \| null — ADMIN или MANAGER; `null` снимает ответственного |
| `deadline` | ISO 8601 \| null |
| `comment` | string \| null (до 2000) |
| `result` | string \| null (до 2000) |
| `blockingReason` | string \| null (до 2000) |

**Разрешённые переходы**

| Из | В |
| --- | --- |
| `NOT_STARTED` | `IN_PROGRESS`, `CANCELLED` |
| `IN_PROGRESS` | `COMPLETED`, `BLOCKED`, `CANCELLED` |
| `BLOCKED` | `IN_PROGRESS`, `CANCELLED` |
| `COMPLETED` | `IN_PROGRESS` (переоткрытие, нужен `comment`) |
| `CANCELLED` | `IN_PROGRESS` (только роль ADMIN, нужен `comment`) |

Остальное — `INVALID_TRANSITION` (409) с `details: { from, to, allowed }`.

**Условия**

| Переход | Требование | Код ошибки |
| --- | --- | --- |
| в `COMPLETED` | непустой `result` (в теле или уже сохранённый) | `VALIDATION_ERROR` |
| в `COMPLETED` | все обязательные пункты чек-листа закрыты | `INVALID_TRANSITION` |
| в `BLOCKED` | непустой `blockingReason` | `VALIDATION_ERROR` |
| в `CANCELLED` | непустой `comment` с основанием | `VALIDATION_ERROR` |
| из `COMPLETED` / `CANCELLED` | непустой `comment` | `VALIDATION_ERROR` |
| этап 14 | любое ручное изменение запрещено | `INVALID_TRANSITION` |
| этапы **6, 7, 11** в `IN_PROGRESS` или `COMPLETED` | все предыдущие этапы закрыты | `INVALID_TRANSITION` |

**Два признака срока.** У текущего этапа связки и у каждого этапа приходят
`isOverdue`, `isPlanShifted` и `isDueSoon`. Они **никогда не верны одновременно**:
этап либо просрочен, либо его план сдвинут, либо вот-вот просрочится, либо ничего из этого.

- `isOverdue` — срок прошёл, а этап **в работе или заблокирован**.
- `isPlanShifted` — срок прошёл, а этап **ещё не начат**. Это не просрочка: срок
  ставится при создании связки и не двигается, когда задерживается этап перед ним
  или держит контрольная точка. В счётчики и списки проблем не идёт (решение 84).
  Интерфейс показывает серую пометку «план сдвинут».
- `isDueSoon` — срок ещё не вышел, но выйдет со дня на день. Порог «вот-вот» —
3 дня (`DEADLINE_WARNING_DAYS`, помечен TEMP).

Счётчики по связке — `progress.overdueStages` и `progress.dueSoonStages`,
они тоже не пересекаются, и один этап не считается дважды.

Это разные по смыслу сигналы: просрочка — уже случившаяся неприятность,
предупреждение — ещё есть время. В интерфейсе их стоит различать цветом,
а не сваливать в одно «проблемные».

**Что НЕ попадает в списки проблемных этапов** — `/api/workflow/overdue`,
`/api/workflow/blocked` и блок проблемных связок дашборда:

- этапы **закрытых связок** (`COMPLETED`, `CANCELLED`): они заморожены, менять
  их нельзя, и требовать по ним действия — значит просить невозможного;
- **этап 14**: вычисляется автоматически и руками не меняется. Он просрочен ровно
  потому, что не закрыты этапы 1–13, а они в списке уже есть — иначе одна
  и та же задержка считалась бы дважды.

Оба списка — это списки дел. В них попадает только то, с чем можно что-то сделать.

**Контрольные точки.** Порядок этапов в целом свободный: в жизни они идут параллельно.
Но три этапа — **6 «Подписание документов»**, **7 «Передача материалов и лицензии»**
и **11 «Проведение занятий»** — нельзя ни начать, ни завершить, пока не закрыты все
предшествующие. Пройти их раньше времени значит записать в систему неправду:
подписать без обмена документами, отдать лицензию без договора, показать занятия
при необученных преподавателях.

Отменённый этап считается закрытым наравне с завершённым — этап 5 необязательный,
и его отмена не должна запирать подписание.

**Точка — шлагбаум для всех следующих этапов.** Этапы за контрольной точкой нельзя
ни начать, ни завершить, ни отметить в их чек-листе пункт, пока точка не **завершена**:
этапы 8–10 ждут этапа 7 (а значит, и 6), этапы 12–13 — этапа 11. Отменённая точка
не пройдена: «договор не понадобился» не значит «договор подписан». Отказ для такого
этапа: «Этап 8 идёт после контрольной точки: его нельзя начать, пока она не завершена.
Не завершены: 6 «…», 7 «…».», `details.isControlPoint` — `false`.

**Блокировка и отмена самой контрольной точки не ограничены:** они ничего
не утверждают о выполненной работе.

Отказ приходит со списком конкретных этапов, чтобы интерфейс мог показать,
что именно закрыть:

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Этап 6 — контрольная точка: его нельзя начать, пока не закрыты предыдущие этапы. Не закрыты: 4 «Обмен документами», 5 «Доработка документов при необходимости».",
    "details": {
      "stageNumber": 6,
      "isControlPoint": true,
      "blockingStages": [
        { "stageNumber": 4, "title": "Обмен документами", "status": "IN_PROGRESS" },
        { "stageNumber": 5, "title": "Доработка документов при необходимости", "status": "NOT_STARTED" }
      ]
    }
  }
}
```

Состав контрольных точек — `CONTROL_POINT_STAGES` в `src/shared/config/workflow.config.ts`,
помечен `TEMP`. Обоснование состава — `docs/CONTROL_POINTS.md`.

**Одновременные изменения.** Обновление условное: если этап успели изменить между чтением
и записью, приходит `CONFLICT` 409 с просьбой обновить страницу. Так двойной клик по кнопке
не создаёт двух одинаковых записей в истории. То же у документов.

**Побочные эффекты:** при смене статуса пишется запись в историю с автором, временем
и текстом (см. `GET /api/workflow/stages/:id/history`);
пересчитывается этап 14; при входе в `COMPLETED` сохраняются `completedAt` и `completedBy`;
при выходе из `COMPLETED` они очищаются; при уходе из `BLOCKED` очищается `blockingReason`;
первый вход в `IN_PROGRESS` проставляет `startedAt`.

```bash
curl -s -X PATCH http://localhost:3000/api/workflow/stages/STAGE_ID \
  -H 'content-type: application/json' \
  -d '{"status":"COMPLETED","result":"Договор подписан обеими сторонами"}'
```

Ответ — этап целиком, чтобы фронт обновил карточку без второго запроса.

### GET /api/workflow/stages/:id/history

Право: `READ`. История изменений, новые записи первыми.

```json
[ { "id": "…", "fromStatus": "IN_PROGRESS", "toStatus": "COMPLETED",
    "comment": "Договор подписан обеими сторонами",
    "changedBy": { "id": "…", "fullName": "…", "role": "MANAGER" },
    "changedAt": "2026-09-21T07:25:02.412Z" } ]
```

Что попадает в `comment`:

| Переход | Текст записи |
| --- | --- |
| в `BLOCKED` | причина блокировки (`blockingReason`) |
| в `COMPLETED` | результат этапа — присланный или сохранённый ранее |
| `BLOCKED` → `IN_PROGRESS` | `comment` запроса — «что изменилось»; **необязателен**, без него запись без текста |
| остальные | `comment` запроса (у отмены и переоткрытия он обязателен) |

Если вместе с причиной или результатом прислан и `comment`, он дописывается с новой строки.
Причина блокировки на самом этапе при снятии блокировки очищается — в истории она остаётся.
Представителю вуза `comment` не показывается (`null`): это внутренний текст.

Автоматический пересчёт этапа 14 тоже попадает в историю с комментарием
«Пересчитано автоматически по состоянию этапов 1–13».

### PATCH /api/workflow/tasks/:id

Право: `WRITE`. Тело: `{ "isDone": true }`. Ответ — **этап целиком**, чтобы фронт сразу обновил
`requiredTasksDone` и прогресс.

### GET /api/workflow/overdue

Право: `READ`. Этапы с прошедшим сроком в работе или заблокированные (`isOverdue`).
Не начатые этапы с прошедшим сроком сюда не входят — у них «план сдвинут».
Параметры: `universityId`, `responsibleId`, `minDaysOverdue`, пагинация. Сортировка — по сроку.

К полям этапа добавляются `universityName`, `programName`, `productName`.

### GET /api/workflow/blocked

Право: `READ`. Этапы в статусе `BLOCKED`. Те же параметры и те же дополнительные поля.

---

## 9. Аналитика

### GET /api/analytics/overview

Право: `ANALYTICS`. Сводка главной страницы (раздел 7.1 ТЗ).

```json
{
  "data": {
    "metrics": [
      { "key": "activeCooperations", "title": "Активные связи", "value": 7, "unit": "связей",
        "basis": "actual", "explanation": "Связки в статусах «Черновик» и «В работе»",
        "period": null, "source": "Данные системы", "isMock": false,
        "trend": { "previous": 6, "delta": 1, "direction": "up", "periodLabel": "за 30 дней" } },
      { "key": "universitiesInWork", "title": "Вузы в работе", "…": "…" },
      { "key": "stagesOnTimePercent", "title": "Этапы, закрытые в срок", "…": "…" },
      { "key": "avgDaysToClasses", "title": "Среднее время до начала занятий", "…": "…" },
      { "key": "operationsPerCooperation", "title": "Операций на связку", "basis": "estimate", "…": "…" }
    ],
    "cooperationCounts": {
      "active": 7, "inWork": 6, "drafts": 1, "paused": 0, "completed": 1, "total": 8
    },
    "topPrograms": [
      { "programId": "…", "programName": "…", "universityId": "…", "universityName": "…",
        "score": 100, "basis": "estimate",
        "factors": [ { "key": "applicationCount", "title": "Заявки на обучение",
                       "value": 420, "weight": 0.4, "contribution": 40 } ] }
    ],
    "problemCooperations": [
      { "cooperationId": "…", "universityName": "…", "universityShortName": "СПбГУТ",
        "programName": "…", "reason": "Этап просрочен на 12 дн.",
        "stageId": "…", "stageNumber": 6,
        "stageTitle": "Подписание документов", "daysOverdue": 12 }
    ],
    "skillMatch": {
      "coveragePercent": 88.9, "coveredSkills": 16, "demandedSkills": 18,
      "criticalGaps": 2, "period": "2026-Q1", "isMock": true
    },
    "generatedAt": "2026-09-21T07:25:10.001Z",
    "containsMockData": true
  }
}
```

`cooperationCounts` — связки по статусам, одна разбивка на все места главной (решение 86):
`active` = `inWork` + `drafts` — это же число в показателе `activeCooperations`, в шапке,
в подсказке меню и под блоком «Связки в работе»; `total` = `active` + `paused` + `completed`
(все, кроме отменённых) — столько связок в воронке. Отменённые не входят никуда.
Совпадает с `/api/cooperations` при тех же фильтрах статуса — это сверяет пробник.

`metrics[].trend` — сравнение с началом периода (30 дней, `TREND_PERIOD_DAYS`), есть
у `activeCooperations` и `stagesOnTimePercent`; у остальных показателей поля нет.
Считается по датам в данных, без снимков: «активные связи» тогда — заведённые к тому
дню и ещё не закрытые (связки на паузе не считаются: историю паузы система не хранит);
«этапы в срок» тогда — та же доля по этапам, закрытым к тому дню. `delta` — в штуках
или процентных пунктах, `direction` — `up` / `down` / `flat`. `trend: null` — сравнить
не с чем (30 дней назад завершённых этапов ещё не было); интерфейс тогда подпись не показывает.

`skillMatch.coveredSkills`, `demandedSkills`, `criticalGaps` — `null`, когда рыночных
данных за период нет (вместе с `coveragePercent: null`). `metrics[].isMock` — посчитан
ли показатель по демонстрационным данным; `avgDaysToClasses` приходит с
`basis: "estimate"`, если среди дат начала занятий есть плановые. Этап 14 в
`stagesOnTimePercent` не считается.

`problemCooperations[].daysOverdue` — сколько дней назад вышел срок, **положительное**
число (до 23.09.2026 пример здесь ошибочно показывал `-12`). `0` — срок вышел сегодня,
причина тогда «Срок этапа вышел сегодня». `null` — этап заблокирован, а не просрочен.

Показатель без данных приходит с `value: null` и `basis: "none"` — фронт показывает «Нет данных».

У проблемной связки `universityShortName` — краткое название вуза для плотного списка,
`stageId` — этап, на котором связка встала: ссылка с главной ведёт прямо к нему.
Оба поля добавлены 23.09.2026, прежние не менялись.

### GET /api/analytics/programs

**Это сводка, а не постраничный список.** Параметр `limit` ограничивает размер выдачи,
`page` и `pageSize` здесь не работают. В `meta`:

| Поле | Что значит |
| --- | --- |
| `total` | сколько найдено **всего**, до обрезания по `limit` |
| `pageSize` | сколько строк отдано в этом ответе |
| `truncated` | `true`, если выдача обрезана |

По ним интерфейс может честно сказать «показаны 50 из 180» и предложить увеличить
выборку. `total` намеренно считается до обрезания: инструмент, который существует ради
показа дефицитов, не должен занижать их число из-за размера страницы.

Право: `ANALYTICS`. Рейтинг программ по трём показателям с раскрытием вклада каждого.
Параметр `limit` (1..200, по умолчанию 20).

```json
{
  "data": [
    {
      "programId": "…", "programName": "Программная инженерия",
      "universityId": "…", "universityName": "СПбГУТ",
      "score": 100, "basis": "estimate",
      "explanation": "Балл рассчитан по 3 из 3 показателей набора и нормирован внутри текущей выборки программ",
      "factors": [
        { "key": "applicationCount", "title": "Заявки на обучение", "value": 420,
          "normalized": 1, "weight": 0.4, "contribution": 40 },
        { "key": "studentCount", "title": "Количество обучающихся", "value": 180,
          "normalized": 1, "weight": 0.4, "contribution": 40 },
        { "key": "groupCount", "title": "Количество параллельных групп", "value": 7,
          "normalized": 1, "weight": 0.2, "contribution": 20 }
      ],
      "isMock": true
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 12 }
}
```

Балл нормируется **внутри выборки ответа**, поэтому сравнивать баллы можно только в пределах
одного запроса. Программы без данных не выбрасываются: они уходят в конец со `score: null`
и `basis: "none"`.

---

## 10. Рекомендации

Рекомендация не заменяет решение сотрудника (раздел 4 ТЗ): она объясняет, почему система
считает действие нужным, и предлагает его.

### POST /api/recommendations/generate

Право: `ANALYTICS_WORK` (ADMIN, MANAGER, ANALYST — решение 98). Пересобирает рекомендации по правилам. Тело не нужно.

Существующие записи обновляются по тройке (`ruleKey`, `objectType`, `objectId`), поэтому
повторный запуск не плодит дубликаты. Что пересборка делает со статусами:

| Статус записи | Правило выдаёт её снова | Правило её больше не выдаёт |
| --- | --- | --- |
| `NEW`, `IN_PROGRESS`, `ACCEPTED` | обновляется текст, статус прежний | закрывается системой: `DONE`, `resolvedById` пуст |
| `DONE` | открывается снова: `NEW` (кроме дефицита навыка, закрытого человеком) | без изменений |
| `DISMISSED` | **без изменений** — решение человека с основанием | без изменений |

Закрытую человеком рекомендацию по дефициту навыка (`skill.critical-gap-with-product`)
пересборка не открывает: её действие — предложить продукт вузам, а дефицит после этого
остаётся, пока вузы не обновят программы. У остальных правил закрыть можно только
ушедшую проблему (см. `PATCH`), поэтому вернувшаяся — снова открыта.

Открытая заново запись встаёт среди свежих (`createdAt` — время пересборки), если это
новый случай проблемы. Тот же случай — просрочка того же этапа с тем же сроком, застой
с тем же последним движением — сохраняет прежний `createdAt`: лента уведомлений
не выдаёт давно известное за новое.

`created` в ответе — созданные и открытые заново, `closed` — закрытые системой.

**Смена статуса или срока этапа и отметка в чек-листе** сразу сверяют открытые
рекомендации этой связки (`stage.overdue`, `cooperation.stalled`, `cooperation.no-product`):
ставшие неправдой закрываются системой, остальные получают свежий текст (просрочка
переходит на следующий этап, число дней). Новых записей и переоткрытий здесь нет —
это дело пересборки. Сбой сверки смену этапа не отменяет.

```bash
curl -s -X POST http://localhost:3000/api/recommendations/generate
```

```json
{ "data": { "created": 10, "updated": 0, "closed": 0, "total": 10,
            "generatedAt": "2026-09-21T08:05:00.000Z" } }
```

**Правила генерации**

| `ruleKey` | Когда срабатывает | Приоритет |
| --- | --- | --- |
| `stage.overdue` | Срок этапа прошёл, этап не закрыт и может быть начат (не стоит не начатым за незавершённой контрольной точкой) | MEDIUM → HIGH (7 дн.) → CRITICAL (21 дн.) |
| `cooperation.stalled` | По связке нет изменений 14 дн., текущий этап не закрыт | MEDIUM, для `BLOCKED` — HIGH |
| `cooperation.no-product` | Связка дошла до этапа 4, продукт не выбран | HIGH |
| `program.missing-metrics` | У программы с начатым сотрудничеством не заполнены показатели набора | MEDIUM, HIGH если пусто всё |
| `skill.critical-gap-with-product` | Навык востребован, отсутствует во всех программах, и есть продукт, который его даёт | HIGH |

Просрочка и застой по одной связке не дублируются: если есть просроченный этап, застой
не показывается — это была бы вторая карточка об одной проблеме.

Не начатый этап за незавершённой контрольной точкой (`findBlockingStages`) не «просрочен»
для рекомендаций и уведомлений: взять его в работу нельзя, и совет «закройте этап 7»
при неподписанном договоре предлагал бы запрещённое. Действие здесь — закрыть точку.
Счётчики просрочек тоже их не считают: с решения 84 не начатый этап вообще
не бывает просрочен — у него «план сдвинут».

### GET /api/recommendations

Право: `ANALYTICS`. Представителю вуза недоступно.

Параметры: `type[]`, `status[]`, `priority[]`, `cooperationId`, `region`,
`sort` (`priority`, `createdAt`, `updatedAt`), пагинация.

**Лента «сначала важное» — `sort=-priority`**, с минусом: приоритет —
перечисление `LOW < MEDIUM < HIGH < CRITICAL`, и `sort=priority` ставит сверху
наименее важное. Значение вынесено в `RECOMMENDATION_SORT_MOST_IMPORTANT`
(`shared/contracts`). При равном приоритете — сначала новые, как в блоке
приоритетных действий на главной. Время создания новым записям генерация
выставляет по важности: сначала просрочки от самой давней, затем дефициты
навыков от самого востребованного, затем остальное (решение 51). Поэтому
порядок при равной важности один и тот же после каждой перезаливки.

```json
{
  "id": "…",
  "type": "SKILL",
  "ruleKey": "skill.critical-gap-with-product",
  "title": "Дефицит навыка «Kubernetes» закрывается нашим продуктом",
  "description": "Предложите вузам Облачная платформа РТК: продукт даёт навык…",
  "priority": "HIGH",
  "justification": "Навык востребован рынком (77 из 100), но отсутствует в 12 программах…",
  "relatedData": { "skillId": "…", "demandNormalized": 0.77, "products": [], "programCount": 12 },
  "confidence": "MEDIUM",
  "status": "NEW",
  "resolutionComment": null,
  "target": { "objectType": "Skill", "objectId": "…", "label": "…" },
  "cooperationId": null,
  "createdAt": "…", "updatedAt": "…", "resolvedAt": null
}
```

### GET /api/recommendations/:id

Право: `ANALYTICS`.

### PATCH /api/recommendations/:id

Право: `ANALYTICS_WORK`. Тело: `{ "status": "IN_PROGRESS", "comment": "Взято в работу" }`.

Статусы — четыре (решение 98): `NEW` → `IN_PROGRESS` → `DONE` / `DISMISSED`.
`ACCEPTED` («Принята») упразднён: миграция перевела такие записи в `IN_PROGRESS`,
войти в него нельзя (409), значение осталось только в перечислении базы.
**Отклонение (`DISMISSED`) требует непустой `comment`** — иначе 422.

**Переходы** — таблица `RECOMMENDATION_TRANSITIONS` в `shared/contracts`, одна на сервер
и интерфейс. Всё, чего в ней нет (в том числе тот же статус), — **409 `INVALID_TRANSITION`**,
`details: { from, to, allowed }`.

| Из | Куда можно |
| --- | --- |
| `NEW` | `IN_PROGRESS`, `DISMISSED` |
| `IN_PROGRESS` | `DONE`, `DISMISSED` |
| `ACCEPTED` (упразднён) | `IN_PROGRESS`, `DONE`, `DISMISSED` |
| `DISMISSED` | `NEW` |
| `DONE` | — (вернувшуюся проблему открывает пересборка) |

**Закрыть (`DONE`) можно только ушедшую проблему.** Для правил с условием, которое
проверяется по данным, — `stage.overdue`, `cooperation.stalled`, `cooperation.no-product`,
`program.missing-metrics` — сервер пересчитывает правило по объекту. Условие всё ещё
выполняется — **409 `CONFLICT`**, рекомендация остаётся в прежнем статусе:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Этап 6 всё ещё просрочен на 12 дн. — закройте или перенесите этап; рекомендацию можно отклонить с основанием.",
    "details": {
      "ruleKey": "stage.overdue",
      "reason": "CONDITION_STILL_HOLDS",
      "relatedData": { "stageNumber": 6, "daysOverdue": 12, "deadline": "…", "status": "IN_PROGRESS" }
    }
  }
}
```

Не согласен с рекомендацией — отклонить с основанием. Дефицит навыка закрывается
без проверки: его действие — предложить продукт, дефицит после этого остаётся.

Статус меняется условно — только если он всё ещё тот, из которого проверен переход.
Изменили параллельно — **409 `CONFLICT`** «Рекомендацию уже изменили…».

```bash
curl -s -X PATCH http://localhost:3000/api/recommendations/<id> \
  -H 'content-type: application/json' -d '{"status":"DONE"}'
```

Комментарий сотрудника пишется в `resolutionComment`; `justification` — обоснование системы —
не переписывается.

---

## 10а. ИИ-помощник (решение 90)

Три черновика текста для человека: сводка по связке, письмо вузу по рекомендации
и «что сделать сегодня». **Модель ничего не решает и данных не меняет.** Что сказать,
определяют правила рекомендаций и сервисы, которые уже есть: карточка связки,
лента рекомендаций, проблемные этапы. Модель получает готовые факты и только
переписывает их читаемым текстом.

Провайдер — `AI_ASSIST_PROVIDER`: `off` (по умолчанию), `yandexgpt`, `gigachat`.
Помощник выключен, не настроен, модель ответила ошибкой, пустотой, не по формату,
не уложилась в `AI_ASSIST_TIMEOUT_MS` или исчерпан лимит — **тот же текст собирается
шаблоном из тех же фактов**, ответ 200 с `source: "template"`. Сбой модели никогда
не даёт 500.

**Персональные данные в модель не уходят.** В промпт идут названия вуза, программы
и продукта, номера и названия этапов, статусы, дни, приоритеты и тексты правил.
ФИО сотрудников и контактных лиц, почта и телефоны вырезаются из каждой строки,
в том числе из причин блокировок, которые пишет человек
(см. [SECURITY_LIMITATIONS.md](SECURITY_LIMITATIONS.md)).

Тело запроса не нужно. Ничего не генерируется при открытии страниц — только по кнопке.

**Ответ — `AiDraftDto`** (`shared/contracts/ai-assist.ts`):

| Поле | Тип | Что это |
| --- | --- | --- |
| `kind` | `cooperation-summary` \| `recommendation-letter` \| `today` | Вид черновика |
| `text` | string | Черновик. Отправлять без проверки человеком нельзя |
| `source` | `yandexgpt` \| `gigachat` \| `template` | Кто написал текст |
| `model` | string \| null | Модель, если писала модель; `null` — шаблон |
| `generatedAt` | string | ISO 8601 |
| `facts` | string[] | Факты, из которых собран текст, — ровно то, что ушло в модель |
| `fallbackReason` | string \| null | Почему шаблон: `disabled`, `not-configured`, `rate-limited`, `timeout`, `failed`, `empty`, `invalid`, `no-facts`; `null` — писала модель |
| `cached` | boolean | Ответ модели из кэша: те же факты за последние 10 минут |

Интерфейс обязан показывать источник: `aiDraftSourceNote(draft)` даёт
«Черновик ИИ (YandexGPT) — проверьте перед отправкой» или
«Шаблон без ИИ: помощник не подключён». Подписи причин — `AI_FALLBACK_REASON_LABELS`.

**Лимит и кэш.** Не больше 20 обращений к модели на пользователя в час
(`AI_ASSIST_LIMITS`, TEMP); дальше — шаблон с `fallbackReason: "rate-limited"`.
Ответ модели на те же факты 10 минут отдаётся из кэша и лимит не расходует.
Шаблон не кэшируется и лимит не расходует. Состояние — в памяти процесса.

**Журнал.** Каждая генерация пишет `ai.draft` в журнал действий: кто, вид, объект,
провайдер, модель или шаблон и причина. Текст промпта и ответа в журнал не пишется.

### POST /api/cooperations/:id/ai-summary

Право: `ANALYTICS`. Представителю вуза — 403, несуществующая связка — 404.

Сводка в 3–5 предложениях: где связка сейчас, что мешает, что сделать дальше. Факты —
вуз, программа, продукт, статус связки, текущий этап (номер, название, статус, срок,
просрочка), пройдено N из 13, просроченные и заблокированные этапы с причиной
блокировки (кроме запертых контрольной точкой — решение 83), открытые рекомендации
по связке (заголовок, приоритет, действие), дата начала занятий.

```bash
curl -s -X POST http://localhost:3000/api/cooperations/<id>/ai-summary
```

```json
{
  "data": {
    "kind": "cooperation-summary",
    "text": "Связка СПбГУТ — «Программная инженерия» с продуктом «Конвейер сборки и поставки» на этапе 6 «Подписание документов» (в работе), пройдено 5 из 13 этапов. Мешает: этап 6 «Подписание документов» — просрочен на 57 дней. Дальше по правилам: свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием. Начало занятий: 09.12.2026, через 75 дней.",
    "source": "template",
    "model": null,
    "generatedAt": "2026-09-25T09:00:00.000Z",
    "facts": [
      "Вуз: СПбГУТ (Санкт-Петербургский государственный университет телекоммуникаций)",
      "Программа: «Программная инженерия»",
      "IT-продукт: «Конвейер сборки и поставки»",
      "Статус связки: В работе",
      "Пройдено этапов: 5 из 13",
      "Текущий этап: 6 «Подписание документов», статус «В работе», срок 30.07.2026, просрочен на 57 дней",
      "Проблемные этапы: этап 6 «Подписание документов» — просрочен на 57 дней",
      "Открытые рекомендации по связке: «Просрочен этап 6: Подписание документов» (приоритет критичный), действие: Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием.",
      "Начало занятий: 09.12.2026, через 75 дней"
    ],
    "fallbackReason": "disabled",
    "cached": false
  }
}
```

### POST /api/recommendations/:id/ai-letter

Право: `WRITE` (ADMIN, MANAGER): письмо — действие от имени ИТ-Школы, а не просмотр.
Остальным — 403, несуществующая рекомендация — 404.

Вежливое деловое письмо от лица ИТ-Школы РТК представителю вуза: тема, «Уважаемые
коллеги!», ситуация, что нужно от вуза, плановый срок (только если он есть в данных
правила), подпись «С уважением, ИТ-Школа РТК». Без имён, должностей и контактов.
Внутренние заметки (причины блокировок, комментарии к этапам) в письмо не попадают.
Письмо никуда не отправляется.

| Правило | Что нужно от вуза |
| --- | --- |
| `stage.overdue` | Сообщить, на каком шаге этап, что мешает, согласовать новую дату; плановый срок этапа |
| `cooperation.stalled` | Сообщить, как продвигается этап и нужна ли помощь |
| `cooperation.no-product` | Подтвердить, какой IT-продукт рассматривается, или что он не нужен |
| `program.missing-metrics` | Сообщить недостающие показатели программы или внести их в кабинете вуза |
| `skill.critical-gap-with-product` | Рассмотреть продукт, который даёт востребованный навык |

```bash
curl -s -X POST http://localhost:3000/api/recommendations/<id>/ai-letter
```

```json
{
  "data": {
    "kind": "recommendation-letter",
    "text": "Тема: Этап «Подписание документов» по программе «Программная инженерия»\n\nУважаемые коллеги!\n\nСовместная работа по программе «Программная инженерия»: этап «Подписание документов» не завершён, плановый срок был 30.07.2026, прошло 57 дней.\n\nПросим сообщить, на каком шаге сейчас этап «Подписание документов», что мешает его завершить, и согласовать новую дату завершения.\n\nБудем признательны за ответ.\n\nС уважением,\nИТ-Школа РТК",
    "source": "template",
    "model": null,
    "generatedAt": "…",
    "facts": ["Отправитель: ИТ-Школа РТК", "Получатель: представитель вуза …", "Тема: …", "Ситуация: …", "Что нужно от вуза: …", "Срок: плановый срок этапа — 30.07.2026"],
    "fallbackReason": "disabled",
    "cached": false
  }
}
```

### POST /api/ai/today

Право: `ANALYTICS`. Представителю вуза — 403.

«Что сделать сегодня» для текущего пользователя: 3–7 дел с одной строкой «почему».
Дела — его открытые рекомендации (по связкам, где он ответственный) и проблемные
этапы его связок (срок вышел или этап заблокирован, связка открыта). Этап, о просрочке
которого уже есть рекомендация, второй раз не идёт; этап за незавершённой контрольной
точкой не идёт вовсе. **Порядок задают правила** — `compareDraftsByImportance`, как у ленты
рекомендаций; важность просрочки этапа — по порогам правила `stage.overdue`. Своих дел
меньше трёх — добираются общие открытые рекомендации (у кого своих связок нет — вся
лента по порядку). Модель только формулирует и должна вернуть ровно столько пунктов,
сколько дел; иначе — шаблон с `fallbackReason: "invalid"`. Дел нет — шаблон
«дел нет», `fallbackReason: "no-facts"`, модель не вызывается.

```bash
curl -s -X POST http://localhost:3000/api/ai/today
```

```json
{
  "data": {
    "kind": "today",
    "text": "Что сделать сегодня — 5 дел в порядке важности:\n\n1. Просрочен этап 5: Доработка документов при необходимости. Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием. (НГТУ — Искусственный интеллект и машинное обучение)\n   Почему: Нормативный срок этапа прошёл 21 дн. назад, этап всё ещё в статусе «В работе».\n…",
    "source": "template",
    "model": null,
    "generatedAt": "…",
    "facts": ["1. [Критичный приоритет] Просрочен этап 5: … Где: НГТУ — … Почему: …", "…"],
    "fallbackReason": "disabled",
    "cached": false
  }
}
```

**Ошибки всех трёх маршрутов:** `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404
(связка или рекомендация), `INTERNAL` 500 — только при сбое базы, не модели.
`INTEGRATION_ERROR` эти маршруты не отдают: сбой модели — это шаблон.

---

## 11. Документы

В MVP хранятся метаданные и ссылка. Загрузка файлов — P2 (решение 14).

### GET /api/documents

Право: `READ`. Параметры: `q`, `cooperationId`, `universityId`, `programId`, `type[]`,
`status[]`, `sort` (`title`, `status`, `createdAt`, `updatedAt`), пагинация.

```json
{
  "id": "…", "type": "AGREEMENT", "title": "Договор о сотрудничестве",
  "version": "2", "status": "SIGNED",
  "fileReference": "https://example.invalid/docs/agreement-2.pdf",
  "content": null,
  "templateKey": null,
  "templateName": null,
  "author": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "responsible": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "issuedAt": "…", "signedAt": "…",
  "links": { "cooperationId": "…", "universityId": "…",
             "universityName": "Санкт-Петербургский государственный университет телекоммуникаций",
             "universityShortName": "СПбГУТ", "programId": null, "programName": null },
  "createdAt": "…", "updatedAt": "…"
}
```

`templateName` — название шаблона по-русски («Договор о сотрудничестве»), `null` у документа,
заведённого вручную. Добавлено 25.09.2026, чтобы интерфейс не показывал ключ `agreement`;
`templateKey` не менялся.

### GET /api/documents/:id

Право: `READ`. Дополнительно `history[]` — изменения статусов с автором и временем.

### POST /api/documents

Право: `WRITE`. Ответ 201.

| Поле | Обязательно |
| --- | --- |
| `type` | да |
| `title` | да (3..300) |
| `cooperationId` / `universityId` / `programId` | **хотя бы одно** — иначе 422 |
| `version` | нет, по умолчанию `"1"` |
| `fileReference` | нет, ссылка `http://` или `https://`, до 2000 символов |
| `responsibleId`, `issuedAt` | нет |

### PATCH /api/documents/:id

Право: `WRITE`. Подписанный и архивный документ не редактируются — `CONFLICT` 409.

### PATCH /api/documents/:id/status

Право: `WRITE`. Тело: `{ "status": "REVIEW", "comment": "…" }`.

| Из | В |
| --- | --- |
| `DRAFT` | `REVIEW`, `ARCHIVED` |
| `REVIEW` | `APPROVED`, `REJECTED`, `DRAFT`, `ARCHIVED` |
| `APPROVED` | `SIGNED`, `REVIEW`, `ARCHIVED` |
| `SIGNED` | `ARCHIVED` |
| `REJECTED` | `DRAFT`, `ARCHIVED` |
| `ARCHIVED` | — |

Условия: отправка на согласование требует заполненного `fileReference`; отклонение и возврат
на доработку требуют `comment`. Переход в `SIGNED` проставляет `signedAt` (электронной подписи
нет, фиксируются факт и дата). Каждое изменение пишется в историю.

**Подпись отмечает этап 6** (решение 87). Когда договор (`AGREEMENT`) или лицензия (`LICENSE`)
связки переходит в `SIGNED`, сервер проверяет: договор по связке подписан и другие договоры
подписи не ждут (лицензию этап 6 не ждёт — она для этапа 7). Если да — отмечает три пункта
чек-листа этапа 6 «Подписание документов» по тем же правилам, что отметка руками: не на закрытой
связке, не на завершённом или отменённом этапе и не за контрольной точкой. Автор отметки — тот,
кто подписал документ; в журнале у отметки `source: "document.signed"` и `documentId`.
Статус документа меняется в любом случае. Ответ — документ и что стало с этапом:

```json
{
  "data": {
    "id": "…", "status": "SIGNED", "signedAt": "2026-09-25T10:00:00.000Z", "…": "…",
    "stageChecklist": { "stageNumber": 6, "marked": 3, "outcome": "marked" }
  }
}
```

`stageChecklist` есть только у подписи договора или лицензии связки. `outcome`:
`marked` — отмечено `marked` пунктов; `nothing-to-mark` — уже были отмечены;
`pending-documents` — договор не подписан или другой договор ждёт подписи;
`locked` — этап 6 за контрольной точкой (не закрыты этапы 1–5); `stage-closed` — этап
завершён или отменён; `cooperation-closed` — связка закрыта.

### GET /api/document-templates

Право: `READ`. Шаблоны пакета документов и доступные подстановки реквизитов.

```json
{
  "data": {
    "templates": [
      { "key": "agreement", "type": "AGREEMENT", "name": "Договор о сотрудничестве",
        "title": "Договор о сотрудничестве — {{university.shortName}}",
        "description": "Основной документ связки: закрепляет предмет и стороны.",
        "inDefaultPackage": true,
        "placeholders": ["contact.fullName", "cooperation.goal", "date", "…"] }
    ],
    "placeholders": ["university.name", "program.name", "product.version", "…"]
  }
}
```

### POST /api/cooperations/:id/documents/generate

Право: `WRITE`. Собирает пакет документов по связке с автоподстановкой реквизитов.
Тело необязательно.

| Поле | Описание |
| --- | --- |
| `templateKeys` | какие шаблоны собрать; без списка берётся пакет по умолчанию |
| `force` | пересобрать, даже если документ по шаблону уже есть; лицензию без продукта не собирает |

```json
{
  "data": {
    "cooperationId": "…",
    "created": [
      { "templateKey": "nda", "missing": ["program.code"], "missingLabels": ["код программы"],
        "document": { "id": "…", "title": "Соглашение о неразглашении — СПбГУТ",
                      "content": "СОГЛАШЕНИЕ О НЕРАЗГЛАШЕНИИ…", "templateKey": "nda",
                      "templateName": "Соглашение о неразглашении", "…": "…" } }
    ],
    "skipped": [
      { "templateKey": "agreement", "templateName": "Договор о сотрудничестве",
        "reason": "уже есть: «Договор о сотрудничестве — СПбГУТ», подписан" },
      { "templateKey": "license", "templateName": "Лицензия на IT-продукт",
        "reason": "не выбран IT-продукт — выберите его в связке" }
    ],
    "missingFields": ["program.code"],
    "missingFieldLabels": ["код программы"],
    "generatedAt": "…"
  }
}
```

**Недостающий реквизит не оставляет пустоту.** На его месте в тексте стоит видимый прочерк
`__________`, а сам реквизит перечислен в `missing` документа и в сводном `missingFields`
(ключи подстановок); `missingLabels` и `missingFieldLabels` — те же реквизиты подписями
для человека, в том же порядке. Показывать пользователю — подписи.

**Шаблон не собирается** и попадает в `skipped` с `templateName` и причиной, если:

- в связке уже есть действующий документ по этому шаблону — собранный из него (тот же
  `templateKey`) или того же типа, например договор, заведённый вручную, или новая версия
  собранного. Любой статус, кроме `ARCHIVED`. Причина — «уже есть: «<название>», <статус>».
  `force: true` снимает эту проверку;
- шаблону нужен IT-продукт (лицензия), а в связке он не выбран. Причина — «не выбран
  IT-продукт — выберите его в связке». `force` эту проверку не снимает.

Повторный вызов поэтому ничего не создаёт. Закрытая связка — `CONFLICT` 409.
Добавлено 25.09.2026: `templateName` в `skipped`, `missingLabels`, `missingFieldLabels`,
сверка по типу документа и пропуск лицензии без продукта. Старые поля не менялись.

Собранный документ хранит текст в `content`. Ссылка на файл ему не нужна: на согласование
он уходит и так — текст и есть документ.

### POST /api/documents/:id/versions

Право: `WRITE`. Ответ 201. Создаёт новую версию: номер увеличивается, ссылка на файл
очищается, статус `DRAFT`. Исходный документ уходит в `ARCHIVED` с записью в истории —
одной транзакцией. От документа в `ARCHIVED` — `CONFLICT` 409: новую версию создают
от действующей. Повторный запрос по той же исходной — тоже 409.

---

## 12. Встречи

### GET /api/meetings

Право: `READ`. Параметры: `q`, `cooperationId`, `universityId`, `programId`, `from`, `to`,
`sort` (`date`, `createdAt`, `updatedAt`), пагинация.

```json
{
  "id": "…", "date": "…", "topic": "Согласование условий лицензии",
  "format": "CALL", "result": "Юридическая служба запросила сведения",
  "nextAction": "Подготовить ответ", "nextActionDueAt": "…",
  "responsible": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "participants": [
    { "id": "…", "kind": "user", "name": "Кириллов Пётр Андреевич", "position": "Менеджер" },
    { "id": "…", "kind": "contact", "name": "Ветрова Ирина Павловна", "position": "Замдекана" },
    { "id": "…", "kind": "external", "name": "Иванов И.И.", "position": null }
  ],
  "links": { "cooperationId": "…", "universityId": "…", "universityName": "…",
             "programId": null, "programName": null },
  "createdAt": "…", "updatedAt": "…"
}
```

### POST /api/meetings

Право: `WRITE`. Ответ 201.

| Поле | Обязательно |
| --- | --- |
| `date` | да, ISO 8601 |
| `topic` | да (3..300) |
| `responsibleId` | да |
| `cooperationId` / `universityId` / `programId` | **хотя бы одно** |
| `format` | нет, по умолчанию `ONLINE` |
| `result`, `nextAction`, `nextActionDueAt` | нет |
| `participants[]` | нет; в каждом элементе **ровно одно** из `userId`, `contactId`, `externalName` |

**Если задан `nextAction`, обязателен `nextActionDueAt`** — иначе 422. Следующее действие
без срока не задача, а пожелание.

### PATCH /api/meetings/:id

Право: `WRITE`. Список участников заменяется целиком, если передан.

---

## 13. Кабинет представителя вуза

Роль `UNIVERSITY_REP` видит только свой вуз. Аналитика, рейтинги, рекомендации, другие вузы
и внутренние комментарии к этапам ей недоступны (решение 9).

Сотрудник ИТ-Школы (`ADMIN`, `MANAGER`) может открыть кабинет любого вуза, указав
`?universityId=…`. Без параметра он получит 404. **В кабинете вуза сотрудник только
просматривает** (с 25.09.2026): подтверждение материалов, показатели и заявки — право
`UNIVERSITY_PORTAL_WRITE`, у сотрудника — `FORBIDDEN` 403 «В кабинете вуза сотрудник
только просматривает; подтверждает сам вуз».

### GET /api/portal/overview

Право: `UNIVERSITY_PORTAL`.

```json
{
  "universityId": "…", "universityName": "СПбГУТ",
  "programs": [
    { "id": "…", "name": "…", "level": "BACHELOR",
      "applicationCount": 310, "studentCount": 124, "groupCount": 5,
      "metricsUpdatedAt": "…" }
  ],
  "cooperations": [
    { "id": "…", "programName": "…", "productName": "…", "status": "ACTIVE",
      "currentStageNumber": 10, "currentStageTitle": "…", "currentStageStatus": "IN_PROGRESS",
      "progressPercent": 69, "classesStartAt": "…" }
  ],
  "pendingMaterials": 2,
  "documentsCount": 3,
  "generatedAt": "…"
}
```

### GET /api/portal/materials

Право: `UNIVERSITY_PORTAL`. Материалы, переданные вузу (задачи этапа 7).

```json
[ { "taskId": "…", "title": "Переданы учебные материалы", "cooperationId": "…",
    "programName": "…", "productName": "…",
    "isConfirmed": false, "confirmedAt": null, "stageStatus": "NOT_STARTED",
    "canConfirm": false, "lockedReason": "Не закрыт этап 6 «Подписание документов»" } ]
```

`canConfirm` — подтверждение сейчас примут: пункт не отмечен, связка открыта, этап 7
не завершён и не отменён, и материалы переданы. `lockedReason` — почему ещё не переданы:
этап 7 — контрольная точка, пока не закрыты предыдущие этапы (договор не подписан),
подтверждать нечего; `null` — переданы или уже подтверждены. Оба поля добавлены 23.09.2026.
`pendingMaterials` в `GET /api/portal/overview` считает только пункты с `canConfirm`.

### POST /api/portal/materials/:taskId/confirm

Право: `UNIVERSITY_PORTAL_WRITE`. Тело необязательно: `{ "comment": "Материалы получены" }`.
Текст комментария в журнал действий не пишется — только признак, что он был.
Подтверждать можно только задачи этапа 7 — иначе 404. В ответе — обновлённый список материалов.
Запись идёт той же функцией, что у сотрудника ИТ-Школы (`setTaskDone`), в очереди со сменой
статусов связки, и отказывает так же — 409:
- связка закрыта или этап 7 завершён либо отменён — `CONFLICT`;
- не закрыты этапы до 7-го — `INVALID_TRANSITION`: «Этап 7 — контрольная точка: его пункты
  нельзя отмечать, пока не закрыты предыдущие этапы. Не закрыты: 6 «Подписание документов»».
  То же правило — у `PATCH /api/workflow/tasks/:id`: пункт контрольной точки отмечается
  только после закрытия предыдущих этапов, снять отметку можно всегда.

Повторное подтверждение уже подтверждённого — 200 и в завершённом этапе: ничего не меняет
и в журнал не пишется.

### PATCH /api/portal/programs/:id/metrics

Право: `UNIVERSITY_PORTAL_WRITE`. Тело: `{ "studentCount": 137, "groupCount": 6 }`.

**`applicationCount` через кабинет не правится** — он считается по поданным заявкам.
Попытка передать его даёт 422.

### GET /api/portal/applications, POST /api/portal/applications

Право: чтение — `UNIVERSITY_PORTAL`, создание — `UNIVERSITY_PORTAL_WRITE`.

Создание: `{ "programId": "…", "quantity": 25, "comment": "Заявки весеннего набора" }`.
**Персональных данных обучающихся заявка не содержит** — только количество; неизвестные поля
схема отбрасывает. После создания `applicationCount` программы пересчитывается по сумме заявок
в статусах `NEW`, `CONFIRMED`, `ENROLLED`.

Заявка на программу чужого вуза — 422.

---

## 14. Пользователи, вход и текущая сессия

### Маршруты NextAuth

| Маршрут | Назначение |
| --- | --- |
| `GET /api/auth/csrf` | csrf-токен для форм входа и выхода |
| `GET /api/auth/providers` | список провайдеров (сейчас один — вход по паролю) |
| `POST /api/auth/callback/credentials` | вход: форма с `csrfToken`, `email`, `password` |
| `GET /api/auth/session` | текущая сессия или `null` |
| `POST /api/auth/signout` | выход: форма с `csrfToken` |

Неверный пароль и несуществующий пользователь дают одинаковый результат: по разнице
сообщений можно было бы перебирать существующие адреса.

### GET /api/me

Авторизация: любая. Текущий пользователь и его права — фронт по ним решает, что показывать.

Путь именно `/api/me`, а не `/api/auth/me`: всё пространство `/api/auth/*` занято NextAuth.

```json
{
  "data": {
    "id": "…", "email": "…", "fullName": "…", "position": "Менеджер по работе с вузами",
    "role": "MANAGER", "universityId": null, "universityName": null,
    "permissions": { "canWrite": true, "canSeeAnalytics": true, "canWorkAnalytics": true,
                     "canUsePortal": true, "canWritePortal": false,
                     "canSeeContactDetails": true, "isAdmin": false },
    "passwordTemporary": false
  }
}
```

`position` и `universityName` — для шапки и личного кабинета: имя, должность,
у представителя вуза — название вуза. Могут быть `null`.

`canWritePortal` (с 25.09.2026) — может ли пользователь записывать в кабинете вуза:
`true` только у `UNIVERSITY_REP`. У сотрудника кабинет открывается только для просмотра.

`canSeeContactDetails` (с 25.09.2026, решение 106) — видит ли пользователь почту и телефон
контактных лиц любого вуза: `true` у ADMIN и MANAGER. У представителя вуза `false`, хотя
контакты своего вуза он видит: что именно скрыто, говорит `contactDetailsHidden` в контакте.

`passwordTemporary` (с 25.09.2026, решение 99) — действующий пароль выдан администратором
как временный: личный кабинет показывает плашку «смените временный пароль». Отдельного
поля в базе нет: признак считается по журналу действий — последнее событие пароля
пользователя (`user.create`, `user.password.reset` или `user.password.change`). Событий нет
(демо-пользователи из `db:seed`) — `false`.

### POST /api/me/password

**Общие демо-учётные записи** (`admin@skilllink.demo`, `manager@…`, `manager2@…`, `analyst@…`,
`viewer@…`, `rep@spbgu.example.invalid` — `SHARED_DEMO_ACCOUNTS` в `auth.config.ts`): под ними
входят все проверяющие стенда, поэтому их пароль, роль, данные и доступ не меняются —
`409 CONFLICT` «Это общая демо-учётная запись…». Всё это проверяется на заведённом пользователе.

Авторизация: любая роль, включая `UNIVERSITY_REP`. **Только свой пароль**: пользователь
берётся из сессии, идентификатора в запросе нет. С 25.09.2026, решение 99.

```json
{ "currentPassword": "…", "newPassword": "…" }
```

Ответ `200`: `{ "data": { "changedAt": "2026-09-25T12:00:00.000Z" } }`.

Правила нового пароля: не короче 10 символов, не длиннее 72 байт (дальше bcrypt не читает;
русская буква — два байта), не из одних пробелов, не совпадает с текущим и с адресом почты
(без учёта регистра). Нарушение — `VALIDATION_ERROR` 422 с `details: [{ field: "newPassword", … }]`;
проверяется до проверки текущего пароля. Повтор нового пароля сверяет форма — на сервер он не уходит.

| Ответ | Когда |
| --- | --- |
| `422` `field: "currentPassword"` | «Текущий пароль введён неверно» |
| `403` | «Слишком много неверных попыток. Смена пароля и вход закрыты ещё на N мин.» — текущий пароль проверяется под **тем же ограничением перебора, что и вход** (счётчик «учётная запись + адрес», пять неудач — 15 минут), и неудачи здесь и на входе складываются |

В журнал пишется `user.password.change` — без пароля и хеша. Уже выданные сессии на других
устройствах смена пароля не завершает (JWT, SECURITY_LIMITATIONS.md).

```bash
curl -X POST http://localhost:3000/api/me/password -H 'content-type: application/json' \
  -H 'cookie: authjs.session-token=…' \
  -d '{"currentPassword":"skilllink","newPassword":"мой-новый-пароль-2026"}'
```

### GET /api/me/stats

Авторизация: любая. Блок «Статистика» личного кабинета — всё по связкам и этапам,
где текущий пользователь **ответственный**. Определения те же, что у показателей
дашборда: «активная связка» — черновик или активна, «в срок» — закрыт не позже срока,
«просрочен» — срок прошёл, этап в работе или заблокирован, связка не закрыта, контрольный этап не считается.

```json
{
  "data": {
    "activeCooperations": 3, "universitiesInWork": 2, "programsManaged": 3,
    "stagesOnTimePercent": 75, "stagesCompletedWithDeadline": 12,
    "overdueStages": 2, "containsMockData": true, "generatedAt": "…"
  }
}
```

`stagesOnTimePercent: null` — **«Нет данных»**: у пользователя ещё нет завершённых
этапов со сроком. Не ноль. У представителя вуза и наблюдателя связок нет — нули
здесь настоящие.

### GET /api/notifications

Право: `READ`. Лента под колокольчиком в шапке. Параметры: `limit` (1..50, по умолчанию 20),
`since` — ISO-время последнего просмотра ленты.

Отдельного хранилища уведомлений нет: лента собирается из того, что система и так знает,
поэтому с данными не расходится — закрытый этап перестаёт быть «просроченным» и здесь.

**Прочитанность хранит фронт**: время последнего просмотра — в `localStorage`, его же
передаёт в `since`. Всё новее `since` приходит с `isUnread: true`. «Отметить всё
прочитанным» — записать текущее время. Без `since` непрочитанным считается всё.
`unreadCount` — по всей ленте, а не по показанной части: значок на колокольчике не врёт.

**Одно событие — одно уведомление.** Просрочку этапа знают два источника: срок этапа
(`stage.overdue`) и рекомендация «Просрочен этап N» (`recommendation`). Они склеиваются
по виду события и объекту — связка и номер этапа. Остаётся пункт срока: он ведёт прямо
к этапу, а его время — истёкший срок, поэтому пересборка рекомендаций не выдаёт
известную просрочку за новую. Рекомендация остаётся, если пункта срока у пользователя
нет (этап ведёт другой сотрудник, а связка — его).

**Не начатый этап за незавершённой контрольной точкой** не даёт ни `stage.overdue`,
ни `stage.due-soon`: начать его нельзя. Поэтому просрочек в ленте может быть меньше,
чем в личной статистике (`/api/me/stats`): статистика такие этапы считает.

**Просрочки в показанную часть попадают всегда** (до `limit` штук), остальное место —
по времени; порядок ленты по-прежнему от новых к старым. Время просрочки — истёкший
срок, то есть прошлое, и до 23.09.2026 свежие изменения вытесняли её из ленты целиком.

```json
{
  "data": {
    "items": [
      {
        "id": "stage-overdue:…", "kind": "stage.overdue", "severity": "critical",
        "title": "Просрочен этап 6 «Подписание документов»",
        "description": "СПбГУТ — Программная инженерия",
        "occurredAt": "…", "isUnread": true,
        "target": { "type": "cooperation", "id": "…", "cooperationId": "…", "stageId": "…" }
      }
    ],
    "unreadCount": 7, "generatedAt": "…"
  }
}
```

| `kind` | Когда | `severity` |
| --- | --- | --- |
| `stage.overdue` | срок своего этапа истёк | `critical` |
| `stage.due-soon` | до срока своего этапа меньше `DEADLINE_WARNING_DAYS` | `warning` |
| `stage.changed` | кто-то другой сменил статус этапа в вашей связке | `info`, блокировка — `warning` |
| `document.changed` | кто-то другой сменил статус вашего документа | `info` |
| `recommendation` | открытая рекомендация высокого приоритета по вашей связке — или общая, если открыта аналитика | `CRITICAL` → `critical`, `HIGH` → `warning` |

**Каждое уведомление ведёт к объекту**, а не на главную: `target.type` + `target.id`,
для этапа — ещё `cooperationId` и `stageId`, чтобы открыть связку сразу на нужном этапе.
Все ссылки открываются тем, кому пришло уведомление, — это проверяет пробник.

`occurredAt` — когда событие случилось: для просрочки — истёкший срок, для «скоро
срок» — вход в окно предупреждения. Поэтому уведомление не «оживает» при каждом запросе.
Изменения других людей берутся за последние `NOTIFICATION_WINDOW_DAYS` дней (TEMP, 14).

**Представитель вуза** получает только движение по своему вузу: смены статусов этапов
и документов. Сроков, рекомендаций и внутренних комментариев в его ленте нет.

### GET /api/search

Право: `READ`. Глобальный поиск для окна в стиле Spotlight. Параметры: `q` (от 2 символов),
`limit` — сколько результатов на раздел (1..10, по умолчанию 5).

Собран из тех же списков, что открывает фронт, — поэтому права и видимость те же:
представитель вуза не найдёт чужой вуз. Пустые разделы не приходят.

Связки ищутся по тем же правилам, что `GET /api/cooperations?q=`: по словам, каждое слово —
в полном или кратком имени вуза, программе, продукте, цели или ФИО ответственного.
«спбгут программная» находит «СПбГУТ — Программная инженерия», «Савельева» — связки,
где она ответственная. Отдельного раздела сотрудников нет: страницы сотрудника нет,
а список пользователей закрыт для представителя вуза, — поэтому сотрудник находится
через свои связки, и его ФИО стоит в подписи результата. Заголовок связки — с кратким
именем вуза, если оно есть.

```json
{
  "data": {
    "query": "облач",
    "groups": [
      { "type": "university", "title": "Университеты", "total": 1,
        "items": [ { "type": "university", "id": "…",
                     "title": "Московский технический университет связи и информатики",
                     "subtitle": "МТУСИ · Москва" } ] },
      { "type": "cooperation", "title": "Сотрудничества", "total": 1,
        "items": [ { "type": "cooperation", "id": "…",
                     "title": "МТУСИ — Облачные технологии и инфраструктура",
                     "subtitle": "Облачная платформа РТК · В работе · Кириллов Пётр Андреевич" } ] }
    ]
  }
}
```

Порядок разделов постоянный: `university`, `program`, `cooperation`, `product`, `skill`,
`document`. `total` — сколько всего нашлось в разделе, показано не больше `limit`.
Ссылку фронт строит сам по `type` и `id`.

### GET /api/users

Право: `ANALYTICS`. Справочник для выбора ответственного и участников встреч; администратору —
список вкладки «Настройки → Пользователи».
Параметры: `q`, `role[]`, `universityId`, `includeInactive`, `isActive`, пагинация.

`email` отдаётся только ADMIN и MANAGER; ANALYST и VIEWER получают `null`, и `q` у них
по почте не ищет (с 25.09.2026).

`isActive` (с 25.09.2026): `true` — только действующие, `false` — только заблокированные.
Задан — важнее `includeInactive`; не задан — всё как раньше (без `includeInactive=true`
только действующие). Ответы `/api/users/*` отдаются с `Cache-Control: no-store`.

### Управление пользователями (право `ADMIN`)

С 25.09.2026, решение 99. Всем остальным ролям — `FORBIDDEN` 403 на каждом маршруте ниже.
`UserDto` — тот же, что в списке (`id`, `email`, `fullName`, `position`, `role`,
`universityId`, `universityName`, `isActive`).

**Правило вуза:** у `UNIVERSITY_REP` вуз обязателен (`VALIDATION_ERROR` 422 по полю
`universityId`: «Выберите вуз представителя»), у остальных ролей запрещён (422: «Сотруднику
ИТ-Школы вуз не назначается…»). Несуществующий или архивный вуз — 422. При смене роли
с представителя на другую вуз снимается сам.

**Временный пароль** генерирует сервер: 14 знаков из 54 без похожих (`0/O/o`, `1/l/I/i`),
криптостойкий выбор, в пароле есть заглавная, строчная и цифра. В базе — только хеш bcrypt.
Пароль приходит **один раз** — в ответе на заведение или сброс; получить его повторно нельзя,
только выдать новый.

#### POST /api/users

```json
{ "email": "Ivanova@Example.ru", "fullName": "Иванова Мария Сергеевна",
  "position": "Аналитик", "role": "ANALYST", "universityId": null }
```

Почта приводится к нижнему регистру (так её ищет вход). Ответ `201`:

```json
{ "data": { "user": { "id": "…", "email": "ivanova@example.ru", "fullName": "Иванова Мария Сергеевна",
                      "position": "Аналитик", "role": "ANALYST", "universityId": null,
                      "universityName": null, "isActive": true },
            "temporaryPassword": "E67TjYzg6CthKY" } }
```

Почта уже занята — `CONFLICT` 409 «Пользователь с такой почтой уже есть»,
`details: [{ field: "email", … }]`. Журнал: `user.create` с `{ role, universityId }` — без почты,
ФИО и пароля.

```bash
curl -X POST http://localhost:3000/api/users -H 'content-type: application/json' \
  -H 'cookie: skilllink_user=<id администратора>' \
  -d '{"email":"ivanova@example.ru","fullName":"Иванова Мария Сергеевна","role":"ANALYST"}'
```

#### GET /api/users/:id

Пользователь для окна администратора: `UserDto` и сколько за ним открытой работы —
чтобы до блокировки предупредить, что связки и этапы останутся за ним.

```json
{ "data": { "id": "…", "email": "manager@skilllink.demo", "fullName": "Кириллов Пётр Андреевич",
            "position": "Менеджер партнёрств ИТ-Школы", "role": "MANAGER", "universityId": null,
            "universityName": null, "isActive": true,
            "openCooperations": 3, "openStages": 20, "createdAt": "…" } }
```

`openCooperations` — связки в статусах `DRAFT`, `ACTIVE`, `PAUSED`, где он ответственный;
`openStages` — его этапы `NOT_STARTED`/`IN_PROGRESS`/`BLOCKED` в таких связках. Нет такого — 404.

#### PATCH /api/users/:id

**Общие демо-учётные записи** (`admin@skilllink.demo`, `manager@…`, `manager2@…`, `analyst@…`,
`viewer@…`, `rep@spbgu.example.invalid` — `SHARED_DEMO_ACCOUNTS` в `auth.config.ts`): под ними
входят все проверяющие стенда, поэтому их пароль, роль, данные и доступ не меняются —
`409 CONFLICT` «Это общая демо-учётная запись…». Всё это проверяется на заведённом пользователе.

Любое подмножество полей: `fullName`, `position`, `role`, `universityId`, `isActive`.
Почта не меняется (это логин), пароль — отдельным маршрутом. Пустое тело — 422. Ответ — `UserDto`.

```bash
curl -X PATCH http://localhost:3000/api/users/<id> -H 'content-type: application/json' \
  -H 'cookie: skilllink_user=<id администратора>' -d '{"isActive":false}'
```

**Блокировка** (`isActive: false`) действует сразу: `getCurrentUser()` читает пользователя
из базы с `isActive: true` на каждый запрос, поэтому уже выданная сессия заблокированного
перестаёт работать со следующего запроса, а вход по паролю не принимается.

Отказы — `CONFLICT` 409 с понятным текстом:

| Когда | Текст |
| --- | --- |
| администратор блокирует себя | «Нельзя заблокировать собственную учётную запись» |
| администратор снимает с себя роль `ADMIN` | «Нельзя снять роль администратора с самого себя: это сделает другой администратор» |
| изменение оставит систему без действующего администратора | «Это последний действующий администратор…» |
| `MANAGER`/`ADMIN` с открытыми связками или этапами переводится в роль, которая не может быть ответственной | «Сначала передайте связки: сотрудник отвечает за 3 открытые связки и 20 незакрытых этапов…», `details: { openCooperations, openStages }` |

Ответственного **можно заблокировать** — отказа нет, интерфейс предупреждает, сколько работы
за ним останется. Правило «ответственный — только ADMIN/MANAGER» (`assertStaffResponsible`)
действует при назначении, как и раньше. Проверки идут в транзакции с блокировкой строк
действующих администраторов: две одновременные блокировки друг друга не оставят систему
без администратора.

Журнал: `user.role.change` с `{ from, to }`, `user.block`, `user.unblock`, `user.update`
с `{ fields: [...] }` — только имена полей (ФИО, должность, вуз), без значений.

#### POST /api/users/:id/password-reset

**Общие демо-учётные записи** (`admin@skilllink.demo`, `manager@…`, `manager2@…`, `analyst@…`,
`viewer@…`, `rep@spbgu.example.invalid` — `SHARED_DEMO_ACCOUNTS` в `auth.config.ts`): под ними
входят все проверяющие стенда, поэтому их пароль, роль, данные и доступ не меняются —
`409 CONFLICT` «Это общая демо-учётная запись…». Всё это проверяется на заведённом пользователе.

Новый временный пароль. Тела нет. Ответ `200` — как у `POST /api/users`:
`{ "data": { "user": { … }, "temporaryPassword": "…" } }`. Старый пароль перестаёт подходить
сразу; блокировка входа после неудачных попыток с этой учётной записи снимается.

Свой пароль так не меняется — 409 «Свой пароль меняйте в личном кабинете: там нужен текущий
пароль» (`POST /api/me/password`). Журнал: `user.password.reset` — без пароля.

```bash
curl -X POST http://localhost:3000/api/users/<id>/password-reset \
  -H 'cookie: skilllink_user=<id администратора>'
```

---

## 15. Источники данных и интеграции

### GET /api/integrations/status

Право: `ANALYTICS`. Что настроено, что выключено и почему.

```json
{
  "data": {
    "marketDataProvider": "mock",
    "integrations": [
      { "key": "market-data", "name": "Демонстрационный набор вакансий",
        "enabled": true, "configured": true, "reason": null, "isMock": true },
      { "key": "lms", "name": "LMS (демонстрационный режим)",
        "enabled": false, "configured": false,
        "reason": "Интеграция выключена: LMS_ENABLED=false", "isMock": true },
      { "key": "site", "name": "Сайт (демонстрационный режим)", "…": "…" }
    ],
    "aiAssist": { "provider": "yandexgpt", "name": "YandexGPT", "ready": true,
                  "model": "yandexgpt-lite", "reason": null },
    "checkedAt": "…"
  }
}
```

Наличие конкретных внутренних API заказчика не утверждается.

`aiAssist` (с 25.09.2026, решение 99) — ИИ-помощник (решение 90): `provider` — `off`,
`yandexgpt` или `gigachat` (`AI_ASSIST_PROVIDER`); `ready` — заданы ключ (и у YandexGPT
каталог), связь с моделью не проверяется; `model` — из настройки, у выключенного `null`;
`reason` — чего не хватает («Не задано: YANDEX_FOLDER_ID») или «Помощник выключен:
AI_ASSIST_PROVIDER=off». **Ни ключей, ни их фрагментов, ни идентификатора каталога в ответе
нет** — только имена недостающих переменных. Прежние поля ответа не менялись.

### POST /api/data-sources/sync

Право: `ANALYTICS_WORK` (ADMIN, MANAGER, ANALYST — решение 98). Загружает рыночные данные из активного источника
(`MARKET_DATA_PROVIDER`: `mock`, `csv`, `external-api`, `future-rtk`).
Тело необязательно: `{ "period": "2026-Q1" }`.

```json
{ "data": { "provider": "mock", "period": "2026-Q1",
            "imported": 0, "updated": 18, "unknownSkills": [],
            "isMock": true, "syncedAt": "…" } }
```

Навыки, которых нет в справочнике, **пропускаются и перечисляются** в `unknownSkills`:
создавать записи справочника по строке из внешнего источника нельзя.

Сбой источника — `INTEGRATION_ERROR` 502. Остальная система при этом работает.

### GET /api/data-sources

Право: `ANALYTICS`. Источники с происхождением и количеством привязанных показателей.

---

## 15а. Загрузка реестров из CSV

### POST /api/import?dataset=…&mode=…

Право: `WRITE`. Тело запроса — **сам файл** (`text/csv`), не JSON.

| Параметр | Значения |
| --- | --- |
| `dataset` | `universities`, `programs` |
| `mode` | `preview` (по умолчанию) или `apply` |

**По умолчанию это предпросмотр** — запись происходит только при `mode=apply`. Импорт,
который пишет в базу с первого запроса, слишком легко запустить случайно.

Колонки совпадают с заголовками выгрузки, поэтому цикл «выгрузил → поправил в Excel →
загрузил обратно» работает без переименований. Колонки ищутся по названию, а не по порядку.

| Раздел | Обязательные колонки | Необязательные |
| --- | --- | --- |
| `universities` | Название, Город, Регион | Краткое название, Направлений, Студентов, Сайт |
| `programs` | Вуз, Программа, Уровень | Код, Направление, Длительность мес., Заявки, Обучающихся, Групп |

```bash
curl -s -X POST "http://localhost:3000/api/import?dataset=universities&mode=apply" \
  -H 'content-type: text/csv' --data-binary @universities.csv
```

**Разделитель определяется сам** — по строке заголовков: `;` (русский Excel, наша выгрузка)
или `,` (Excel с английскими настройками, Google Таблицы). Разделители внутри кавычек
не считаются; при равенстве — `;`. Если заголовок всё же прочитан одной колонкой,
ошибка о недостающих колонках говорит и о разделителе.

**Кодировка файла определяется сама.** Excel в Windows по умолчанию сохраняет CSV
в Windows-1251 («CSV UTF-8» — отдельный пункт меню, который легко не заметить).
Такой файл читается правильно, и в ответе видно, как он понят: поле `encoding`
со значением `utf-8` или `windows-1251`. Раньше файл из Excel отвергался
сообщением «Не найдены: Название, Город, Регион» — мусором становилась уже
строка заголовков. Формат «Текст Юникод» (UTF-16) отвергается прямо, с подсказкой,
как пересохранить. Файл с нулевыми байтами (.xlsx, UTF-16 без метки, любой двоичный) —
тоже: «Файл не похож на текстовый CSV», с номером строки.

Ошибка записи строки в `detail` — только текст, который можно показать: сообщение
базы с данными строки в ответ не уходит.

```json
{
  "data": {
    "dataset": "universities", "encoding": "windows-1251", "mode": "apply",
    "totalRows": 7, "created": 1, "updated": 2, "unchanged": 3, "skipped": 0, "errors": 1,
    "rows": [
      { "line": 2, "label": "Уральский федеральный университет",
        "outcome": "update", "detail": "Обновятся: Город, Сайт" },
      { "line": 3, "label": "Донской государственный технический университет",
        "outcome": "unchanged", "detail": "Без изменений" },
      { "line": 8, "label": "Импортированный университет связи",
        "outcome": "create", "detail": "Будет создан вуз в городе Тверь" },
      { "line": 9, "label": "Вуз с плохим числом", "outcome": "error",
        "detail": "Колонка «Студентов»: ожидалось целое число, получено «много»" }
    ],
    "processedAt": "…"
  }
}
```

Что важно:

- **Записи опознаются по названию** (программа — по паре «вуз + программа»), поэтому
  повторная загрузка того же файла не создаёт двойников.
- **Строка с ошибкой не отменяет остальные.** Её номер совпадает с номером строки в Excel.
- **`outcome`:** `create`, `update` (в `detail` — какие колонки меняются), `unchanged`
  (запись найдена, файл ничего в ней не меняет — повторная загрузка выгрузки не выглядит
  правкой реестра), `skip` (архив), `error`. Сравниваются только колонки, которые есть
  в файле. Источник показателей программы становится «импорт», только если файл меняет
  сами показатели.
- **Пустая ячейка — «Нет данных», а не ноль.** Нечисловое значение — ошибка строки,
  чтобы опечатка не превратилась в показатель.
- **Вуз по ходу загрузки программ не создаётся:** опечатка в названии породила бы двойника.
- Загруженные записи не помечаются как демонстрационные: их завёл человек.

---

## 15а. Лента событий вуза

### GET /api/universities/:id/events

Право: `READ`. Вкладка «История» карточки вуза (раздел 7.3 ТЗ).

| Параметр | Тип | Описание |
| --- | --- | --- |
| `limit` | number 1..100 | Сколько последних событий вернуть, по умолчанию 20 |

**Это лента, а не постраничный список.** События собираются из пяти источников —
создание связок, изменения этапов, документы, встречи, заявки — и сортируются
по времени. Поэтому здесь `limit`, а не `page`/`pageSize`.

Точного общего числа в `meta` нет намеренно: посчитать его значило бы прочитать
всю историю вуза целиком. Вместо него приходит **`hasMore`** — показано ли всё.
Этого достаточно, чтобы честно предложить «показать ещё», увеличив `limit`,
и не делать вид, что лента закончилась.

```json
{
  "meta": { "page": 1, "pageSize": 20, "total": 20, "hasMore": true },
  "data": [
    {
      "id": "cooperation:cmub5p35w00c7c7rlmrgjg0zz",
      "kind": "cooperation.created",
      "title": "Создана связка: «Компьютерная безопасность» и «Система мониторинга безопасности»",
      "details": null,
      "cooperationId": "cmub5p35w00c7c7rlmrgjg0zz",
      "programName": "Компьютерная безопасность",
      "author": { "id": "…", "fullName": "Савельева Ольга Дмитриевна", "role": "MANAGER" },
      "occurredAt": "2026-09-21T11:22:56.708Z"
    }
  ]
}
```

`title` и `details` уже на русском и готовы к показу — собирать строку на фронте не нужно.
`id` содержит префикс источника (`cooperation:`, `stage:`, `document:`, `meeting:`) —
годится как ключ списка.

**Представителю вуза** внутренние комментарии сотрудников в `details` не приходят
(решение 9). Чужой вуз — `NOT_FOUND`, а не `FORBIDDEN`.

---

## 15б. Журнал действий

### GET /api/audit

Право: **`ADMIN`**. Остальным ролям — `FORBIDDEN` 403. Раздел 15 ТЗ.

| Параметр | Тип | Описание |
| --- | --- | --- |
| `page`, `pageSize` | number | Пагинация |
| `action` | string | Тип действия, например `stage.status.change` |
| `objectType`, `objectId` | string | Объект, над которым действовали |
| `userId` | string | Автор действия |
| `from`, `to` | ISO 8601 | Период |

```json
{
  "data": [
    {
      "id": "cmub7a170008ftnrlc8cw4kr6",
      "action": "stage.status.change",
      "objectType": "WorkflowStage",
      "objectId": "cmub7a1440071tnrlef1oss0r",
      "payload": { "from": "IN_PROGRESS", "to": "COMPLETED", "stageNumber": 1 },
      "user": { "id": "…", "fullName": "Кириллов Пётр Андреевич", "role": "MANAGER" },
      "createdAt": "2026-09-21T12:07:13.548Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 599 }
}
```

`payload` — это разные поля у разных действий. Персональных данных в нём нет.

`cooperationId` (с 25.09.2026, решение 99) — связка, к которой относится этап
(`objectType: "WorkflowStage"`) или пункт чек-листа (`"Task"`): своей страницы у них нет,
открываются они на странице связки. У остальных объектов — `null`.

Коды действий и типов объектов — `AUDIT_ACTIONS` и `AUDIT_OBJECT_TYPES`
в `shared/contracts/audit.ts`, подписи — `AUDIT_ACTION_LABELS` и `AUDIT_OBJECT_TYPE_LABELS`
в `shared/contracts/labels.ts`. С 25.09.2026 добавлены действия `user.create`, `user.update`,
`user.role.change`, `user.block`, `user.unblock`, `user.password.reset`, `user.password.change`
(объект `User`, `objectId` — id пользователя). Ни пароль, ни хеш в журнал не пишутся.

---

## 15в. Групповая операция: выпуск версии продукта

Обещание концепции: одно действие ставит задачи во всех связках, где передана
устаревшая версия продукта.

### GET /api/products/:id/release?version=2.0

Право: `WRITE`. **Предпросмотр: ничего не меняет.** Показывает, что произойдёт.

### POST /api/products/:id/release

Право: `WRITE`. **Применяет.** Тело: `{ "version": "2.0", "comment": "необязательно" }`.
`comment` попадёт в историю затронутых этапов.

Оба отвечают одинаково, у применения добавляется `appliedAt`:

```json
{
  "data": {
    "productId": "…",
    "productName": "Аналитическая платформа данных",
    "currentVersion": "1.4",
    "nextVersion": "2.0",
    "affectedCooperations": 11,
    "reopenedStages": 3,
    "skipped": 2,
    "targets": [
      {
        "cooperationId": "…",
        "universityName": "СПбГУТ",
        "programName": "Программная инженерия",
        "stageNumber": 12,
        "stageStatus": "IN_PROGRESS",
        "effect": "task-added",
        "reason": "Этап в работе: добавится обязательный пункт о передаче новой версии"
      }
    ]
  }
}
```

| `effect` | Что произойдёт |
| --- | --- |
| `task-added` | В открытый этап добавится обязательный пункт о передаче новой версии |
| `stage-reopened` | Закрытый этап передачи материалов откроется заново |
| `skipped` | Связка не затрагивается, причина — в `reason` |

**Показывайте предпросмотр перед применением.** Операция меняет десятки связок разом,
и `reason` у каждой цели объясняет, почему она попала в список.

Ошибки: `CONFLICT` 409 — у продукта уже указана эта версия; `NOT_FOUND` 404 — продукта нет.

---

## 15г. Выгрузка в CSV

### GET /api/export?dataset=universities

Право: `READ`. Отдаёт **не JSON, а файл**: `text/csv; charset=utf-8`
с заголовком `content-disposition: attachment`.

| Параметр | Значения |
| --- | --- |
| `dataset` | `universities`, `programs`, `cooperations`, `skill-gaps` |
| `limit` | 1..5000, по умолчанию 1000 — защита от случайной выгрузки всей базы |
| `universityId` | ограничить одним вузом (`programs`, `cooperations`, `skill-gaps`) |
| фильтры списка | для `universities`, `programs`, `cooperations` — те же параметры, что у `GET /api/universities`, `/api/programs`, `/api/cooperations` (`q`, `status`, `region`, `minRating`, `level`, `onlyBlocked`, `sort`, `includeArchived` и др.), кроме `page` и `pageSize`. Проверяются той же схемой: кривой фильтр — `VALIDATION_ERROR` |

Кнопка «Выгрузить» в реестрах вузов, программ и связок передаёт фильтры и сортировку
экрана — в файл попадают те же строки и в том же порядке. Без фильтров выгружается
раздел целиком, но, как и в списке, **без архивных** вузов и программ — для них
`includeArchived=true`.

```bash
curl -s -OJ "http://localhost:3000/api/export?dataset=cooperations&q=спбгут&onlyBlocked=true"
```

Файл начинается с BOM и использует `;` как разделитель — так Excel открывает его
без мастера импорта. Заголовки колонок на русском, значения перечислений — словами
из общего словаря подписей (`src/shared/contracts/labels.ts`): «В работе», а не
`IN_PROGRESS`; «демонстрационные данные», а не `MOCK`. Дробные числа — с запятой
(«61,3»): русский Excel иначе не считает их числами.

**Рейтинг.** В выгрузке вузов — колонки «Рейтинг», «Основание рейтинга» и «Учтено программ»,
в выгрузке программ — «Рейтинг», «Основание рейтинга» и «Учтено показателей из 3». Балл
считается тем же кодом, что в интерфейсе (реестр вузов, карточка программы), и совпадает
с экраном. «Нет данных» — пустой балл, а не ноль. Представителю вуза рейтинг недоступен,
и этих колонок в его файле нет.
Формат совпадает с тем, что принимает `POST /api/import`: цикл «выгрузил → поправил
в Excel → загрузил обратно» работает без переименований.

На фронте это обычная ссылка, а не `fetch`: браузер должен сохранить файл.

---

## 15д. Спецификация OpenAPI

### GET /api/openapi.json

Право: открыт. Та же спецификация, что лежит в `docs/openapi.json`, — собирается
из тех же схем, которыми API проверяет входные данные, поэтому разойтись с реальностью
не может. По ней генерируется типизированный клиент.

---

## 16. Чего ещё нет

- уведомления — канал не определён, `TODO: PM DECISION`;
- политики доступа на уровне строк (RLS) — осознанно отложены,
  см. [SECURITY_LIMITATIONS.md](SECURITY_LIMITATIONS.md);
- загрузка файлов документов — P2 по решению 14, в MVP хранятся метаданные,
  ссылка и текст, собранный из шаблона;
- автоматический сбор рыночных данных — ограничение прототипа из концепции.

Актуальное состояние — в [PROGRESS.md](PROGRESS.md).
