# API_CONTRACT.md — контракт API SkillLink

Источник истины для фронта: P0 и серверная часть P1. Любое изменение поля фиксируется здесь
до правки кода.

Все описанные эндпоинты реализованы и проверены сквозным сценарием.

Базовый адрес локально: `http://localhost:3000`.

---

## 1. Общие правила

- JSON наружу — **camelCase**. В базе snake_case через `@map` / `@@map`.
  `TODO: PM DECISION` — подтвердить camelCase с фронтом.
- Даты — строка **ISO 8601 в UTC**: `"2026-09-21T07:24:47.059Z"`.
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

**Из серверных компонентов Next зовите API через `apiFetch`** из
`@/shared/api/server-fetch`, а не голым `fetch`. На сервере запрос уходит от имени
процесса и не несёт cookie пользователя: в демо-режиме API подставит пользователя
по умолчанию и страница покажет чужие данные, в промышленном — вернёт `401`.
Обёртка передаёт cookie и определяет адрес из заголовков запроса.

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
| `ADMIN` | ADMIN |
| `UNIVERSITY_PORTAL` | ADMIN, MANAGER, UNIVERSITY_REP |

### Пагинация, фильтры, сортировка

- `page` — с 1, по умолчанию 1.
- `pageSize` — 1..100, по умолчанию 20.
- `sort` — имя поля; минус спереди означает убывание: `sort=-updatedAt`.
- Повторяющийся параметр собирается в массив: `?status=ACTIVE&status=NEW`.
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
    "email": "contact@spbgu.example.invalid", "phone": "+7 900 000-00-00", "isPrimary": true
  },
  "contacts": [ "…" ],
  "createdAt": "2026-09-21T07:23:11.101Z"
}
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
| `website` | string \| null | нет | корректный URL |
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

### GET /api/programs/:id

Право: `READ`. Дополнительно `skills[]`, `createdAt`, `archivedAt`.

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
      "isMock": true
    }
  ],
  "meta": { "page": 1, "pageSize": 18, "total": 18, "period": "2026-Q1", "programId": null, "isMock": true }
}
```

---

## 6. IT-продукты

### GET /api/products

Право: `READ`. Параметры: `q`, `category[]`, `status[]` (`PLANNED`, `ACTIVE`, `DEPRECATED`),
`skillId[]`, `sort` (`name`, `category`, `status`, `updatedAt`), пагинация.

### GET /api/products/:id

Право: `READ`. Дополнительно `description` и `skills[]` с полем
`relevance` (`CORE`, `RELATED`, `OPTIONAL`).

---

## 7. Сотрудничество

### GET /api/cooperations

Право: `READ`.

| Параметр | Описание |
| --- | --- |
| `q` | Поиск по вузу, программе, продукту, цели |
| `universityId`, `programId`, `productId`, `responsibleId` | Точные фильтры |
| `status` | enum[]: `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED` |
| `onlyOverdue` | `true` — только связки с просроченными этапами |
| `onlyBlocked` | `true` — только связки с заблокированными этапами |
| `sort` | `status`, `createdAt`, `updatedAt`, `targetDate`, `classesStartAt` |

`CooperationListItemDto`:

```json
{
  "id": "…",
  "universityId": "…", "universityName": "СПбГУТ",
  "programId": "…",    "programName": "Информационная безопасность…",
  "productId": "…",    "productName": "Система мониторинга безопасности",
  "status": "ACTIVE",
  "responsible": { "id": "…", "fullName": "Кириллов Пётр Андреевич", "role": "MANAGER" },
  "currentStage": {
    "id": "…", "stageNumber": 10, "title": "Обновление образовательной программы",
    "phase": "IMPLEMENTATION", "status": "IN_PROGRESS",
    "deadline": "2026-10-15T00:00:00.000Z", "isOverdue": false
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

### PATCH /api/cooperations/:id

Право: `WRITE`. Поля: `productId`, `responsibleId`, `status`, `goal`, `notes`, `firstContactAt`,
`classesStartAt`, `targetDate`. Пустое тело — 422. Закрытую связку (`COMPLETED`, `CANCELLED`)
править нельзя, кроме смены статуса — `CONFLICT`. `productId: null` отвязывает продукт.

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
| `responsibleId` | string \| null |
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
`isOverdue` и `isDueSoon`. Они **никогда не верны одновременно**: этап либо
просрочен, либо вот-вот просрочится, либо ни то ни другое. Порог «вот-вот» —
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

**Побочные эффекты:** при смене статуса пишется запись в историю с автором и временем;
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
    "comment": null, "changedBy": { "id": "…", "fullName": "…", "role": "MANAGER" },
    "changedAt": "2026-09-21T07:25:02.412Z" } ]
```

Автоматический пересчёт этапа 14 тоже попадает в историю с комментарием
«Пересчитано автоматически по состоянию этапов 1–13».

### PATCH /api/workflow/tasks/:id

Право: `WRITE`. Тело: `{ "isDone": true }`. Ответ — **этап целиком**, чтобы фронт сразу обновил
`requiredTasksDone` и прогресс.

### GET /api/workflow/overdue

Право: `READ`. Этапы с прошедшим сроком, не закрытые и не отменённые.
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
      { "key": "activeCooperations", "title": "Активные связи", "value": 6, "unit": "связей",
        "basis": "actual", "explanation": "Связки в статусах «Черновик» и «В работе»",
        "period": null, "source": "Данные системы", "isMock": false },
      { "key": "universitiesInWork", "title": "Вузы в работе", "…": "…" },
      { "key": "stagesOnTimePercent", "title": "Этапы, закрытые в срок", "…": "…" },
      { "key": "avgDaysToClasses", "title": "Среднее время до начала занятий", "…": "…" },
      { "key": "operationsPerCooperation", "title": "Операций на связку", "basis": "estimate", "…": "…" }
    ],
    "topPrograms": [
      { "programId": "…", "programName": "…", "universityId": "…", "universityName": "…",
        "score": 100, "basis": "estimate",
        "factors": [ { "key": "applicationCount", "title": "Заявки на обучение",
                       "value": 420, "weight": 0.4, "contribution": 40 } ] }
    ],
    "problemCooperations": [
      { "cooperationId": "…", "universityName": "…", "programName": "…",
        "reason": "Этап просрочен на 12 дн.", "stageNumber": 6,
        "stageTitle": "Подписание документов", "daysOverdue": -12 }
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

Показатель без данных приходит с `value: null` и `basis: "none"` — фронт показывает «Нет данных».

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

Право: `WRITE`. Пересобирает рекомендации по правилам. Тело не нужно.

Существующие записи обновляются по тройке (`ruleKey`, `objectType`, `objectId`), поэтому
повторный запуск не плодит дубликаты. **Решение сотрудника не переписывается:** принятая или
отклонённая рекомендация сохраняет свой статус. Рекомендации, которые правила больше не
выдают, закрываются со статусом `DONE`.

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
| `stage.overdue` | Срок этапа прошёл, этап не закрыт | MEDIUM → HIGH (7 дн.) → CRITICAL (21 дн.) |
| `cooperation.stalled` | По связке нет изменений 14 дн., текущий этап не закрыт | MEDIUM, для `BLOCKED` — HIGH |
| `cooperation.no-product` | Связка дошла до этапа 4, продукт не выбран | HIGH |
| `program.missing-metrics` | У программы с начатым сотрудничеством не заполнены показатели набора | MEDIUM, HIGH если пусто всё |
| `skill.critical-gap-with-product` | Навык востребован, отсутствует во всех программах, и есть продукт, который его даёт | HIGH |

Просрочка и застой по одной связке не дублируются: если есть просроченный этап, застой
не показывается — это была бы вторая карточка об одной проблеме.

### GET /api/recommendations

Право: `ANALYTICS`. Представителю вуза недоступно.

Параметры: `type[]`, `status[]`, `priority[]`, `cooperationId`, `region`,
`sort` (`priority`, `createdAt`, `updatedAt`), пагинация.

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

Право: `WRITE`. Тело: `{ "status": "ACCEPTED", "comment": "Взято в работу" }`.

Статусы: `NEW`, `IN_PROGRESS`, `ACCEPTED`, `DISMISSED`, `DONE`.
**Отклонение (`DISMISSED`) требует непустой `comment`** — иначе 422.

Комментарий сотрудника пишется в `resolutionComment`; `justification` — обоснование системы —
не переписывается.

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
  "author": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "responsible": { "id": "…", "fullName": "…", "role": "MANAGER" },
  "issuedAt": "…", "signedAt": "…",
  "links": { "cooperationId": "…", "universityId": "…", "universityName": "СПбГУТ",
             "programId": null, "programName": null },
  "createdAt": "…", "updatedAt": "…"
}
```

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
| `fileReference` | нет, корректный URL |
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

### GET /api/document-templates

Право: `READ`. Шаблоны пакета документов и доступные подстановки реквизитов.

```json
{
  "data": {
    "templates": [
      { "key": "agreement", "type": "AGREEMENT",
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
| `force` | пересобрать, даже если документ по шаблону уже есть |

```json
{
  "data": {
    "cooperationId": "…",
    "created": [
      { "templateKey": "agreement", "missing": ["program.code"],
        "document": { "id": "…", "title": "Договор о сотрудничестве — СПбГУТ",
                      "content": "ДОГОВОР О СОТРУДНИЧЕСТВЕ…", "templateKey": "agreement", "…": "…" } }
    ],
    "skipped": [ { "templateKey": "nda", "reason": "Документ по этому шаблону в связке уже есть" } ],
    "missingFields": ["program.code"],
    "generatedAt": "…"
  }
}
```

**Недостающий реквизит не оставляет пустоту.** На его месте в тексте стоит видимый прочерк
`__________`, а сам реквизит перечислен в `missing` документа и в сводном `missingFields`.
Документ с невидимой дырой подписали бы не глядя — с явным пропуском заполнят.

Повторный вызов не создаёт дубликаты: шаблоны, по которым документ в связке уже есть,
попадают в `skipped` с причиной.

Собранный документ хранит текст в `content`. Ссылка на файл ему не нужна: на согласование
он уходит и так — текст и есть документ.

### POST /api/documents/:id/versions

Право: `WRITE`. Ответ 201. Создаёт новую версию: номер увеличивается, ссылка на файл
очищается, статус `DRAFT`. Исходный документ уходит в `ARCHIVED` с записью в истории.

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
`?universityId=…`. Без параметра он получит 404.

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
    "isConfirmed": false, "confirmedAt": null, "stageStatus": "IN_PROGRESS" } ]
```

### POST /api/portal/materials/:taskId/confirm

Право: `UNIVERSITY_PORTAL`. Тело необязательно: `{ "comment": "Материалы получены" }`.
Подтверждать можно только задачи этапа 7 — иначе 404. В ответе — обновлённый список материалов.

### PATCH /api/portal/programs/:id/metrics

Право: `UNIVERSITY_PORTAL`. Тело: `{ "studentCount": 137, "groupCount": 6 }`.

**`applicationCount` через кабинет не правится** — он считается по поданным заявкам.
Попытка передать его даёт 422.

### GET /api/portal/applications, POST /api/portal/applications

Право: `UNIVERSITY_PORTAL`.

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
    "id": "…", "email": "…", "fullName": "…", "role": "MANAGER", "universityId": null,
    "permissions": { "canWrite": true, "canSeeAnalytics": true,
                     "canUsePortal": true, "isAdmin": false }
  }
}
```

### GET /api/users

Право: `ANALYTICS`. Справочник для выбора ответственного и участников встреч.
Параметры: `q`, `role[]`, `universityId`, `includeInactive`, пагинация.

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
    "checkedAt": "…"
  }
}
```

Наличие конкретных внутренних API заказчика не утверждается.

### POST /api/data-sources/sync

Право: `WRITE`. Загружает рыночные данные из активного источника
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

```json
{
  "data": {
    "dataset": "universities", "mode": "apply",
    "totalRows": 7, "created": 1, "updated": 6, "skipped": 0, "errors": 1,
    "rows": [
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
| `universityId` | ограничить одним вузом |

Файл начинается с BOM и использует `;` как разделитель — так Excel открывает его
без мастера импорта. Заголовки колонок на русском, значения перечислений — словами.
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
