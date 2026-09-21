# SkillLink

Система контроля взаимодействия с учебными заведениями для приобретения навыков работы
с востребованными на рынке цифровыми инструментами. MVP для IT Школы РТК.

Единица учёта — связка «вуз — образовательная программа — IT-продукт». По каждой связке
система ведёт 14 этапов сотрудничества с чек-листами и контролем сроков, сопоставляет навыки
программ с востребованностью на рынке труда и показывает объяснимую аналитику.

---

## Требования

- Node.js 20 и новее (проверено на 26.8.1)
- PostgreSQL 16 — локально или в Docker
- npm 10 и новее

## Установка

```bash
npm install
```

Если npm заблокировал установочные скрипты Prisma (сообщение `install-scripts`):

```bash
npm install-scripts approve @prisma/engines prisma @prisma/client
```

## База данных

### Вариант 1: Docker

```bash
docker compose up -d
```

Поднимет `postgres:16-alpine` на порту 5432 с базой, пользователем и паролем `skilllink`.

### Вариант 2: локальный PostgreSQL

```bash
createuser skilllink --createdb --pwprompt
createdb skilllink --owner skilllink
```

Право `CREATEDB` нужно `prisma migrate` для теневой базы. В промышленном контуре миграции
применяются командой `npm run db:deploy`, и это право не требуется.

### Переменные окружения

```bash
cp .env.example .env
```

Минимально достаточно `DATABASE_URL`:

```
DATABASE_URL="postgresql://skilllink:skilllink@localhost:5432/skilllink?schema=public"
```

Для продакшена дополнительно обязательны `AUTH_SECRET` (`openssl rand -base64 32`)
и `DEMO_AUTH_ENABLED="false"`.

### Миграции и демонстрационные данные

```bash
npm run db:migrate    # применить миграции и сгенерировать клиент Prisma
npm run db:seed       # загрузить демонстрационные данные
```

`db:seed` полностью очищает таблицы перед загрузкой. Все загружаемые записи помечены
`isMock: true` и **не являются подтверждённой статистикой**.

## Запуск

```bash
npm run dev
```

Приложение — `http://localhost:3000`, проверка живости — `http://localhost:3000/api/health`.

Страница по адресу `/` — заглушка: интерфейс подключается отдельно.

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run dev` | Сервер разработки на порту 3000 |
| `npm run build` | Сборка |
| `npm start` | Запуск собранного приложения |
| `npm run typecheck` | Проверка типов |
| `npm test` | Модульные тесты (Vitest) |
| `npm run smoke` | Сквозной сценарий против запущенного сервера |
| `npm run db:migrate` | Создать и применить миграцию |
| `npm run db:deploy` | Применить миграции без создания новых (промышленный контур) |
| `npm run db:seed` | Демонстрационные данные |
| `npm run db:reset` | Сбросить базу, применить миграции заново, загрузить данные |
| `npm run db:studio` | Визуальный редактор базы |
| `npm run db:generate` | Пересобрать клиент Prisma |

## Тесты

```bash
npm run typecheck
npm test
```

237 тестов: таблица переходов этапов, условия завершения и блокировки, автоматический пересчёт
контрольного этапа, расчёт рейтинга, дефицит навыков, правила рекомендаций, жизненный цикл
документов, встречи, права ролей, кабинет вуза, интеграции и валидация схем.

### Сквозной сценарий

В одном окне:

```bash
npm run dev
```

В другом:

```bash
npm run smoke
```

250 проверок по разделам 17 и 18 ТЗ: подключение к базе, дашборд, реестр вузов, создание вуза
и программы, привязка навыков, продукты, создание связки с 14 этапами, работа с чек-листом,
допустимые и недопустимые переходы статусов, прогресс и история, просроченные и заблокированные
этапы, востребованность навыков, дефициты, рейтинг программ, фильтры, рекомендации, документы,
встречи, кабинет представителя вуза, интеграции, журнал действий, лента событий,
групповые операции по продукту и вход по паролю.

Сценарий переключает пользователя через cookie и отдельно проверяет, что представитель вуза
не видит чужие вузы, аналитику и внутренние комментарии к этапам.

## Демонстрационный сценарий

Раздел 18 ТЗ, целиком воспроизводится сквозным сценарием:

1. Открыть дашборд — `GET /api/analytics/overview`.
2. Перейти в реестр вузов — `GET /api/universities`.
3. Открыть карточку вуза — `GET /api/universities/:id`.
4. Перейти к программе — `GET /api/programs/:id`.
5. Посмотреть навыки, востребованность и дефициты — `GET /api/skills/demand`,
   `GET /api/skills/gaps?programId=:id`.
6. Открыть рейтинг программ — `GET /api/analytics/programs`.
7. Создать связку — `POST /api/cooperations`. Сразу появляются все 14 этапов.
8. Посмотреть текущий этап и чек-лист — `GET /api/cooperations/:id`.
9. Закрыть пункты чек-листа — `PATCH /api/workflow/tasks/:id`.
10. Завершить этап — `PATCH /api/workflow/stages/:id` со статусом `COMPLETED` и результатом.
11. Убедиться, что прогресс и история обновились — `GET /api/cooperations/:id`,
    `GET /api/workflow/stages/:id/history`.
12. Посмотреть проблемные связи — `GET /api/workflow/overdue`, `GET /api/workflow/blocked`.
13. Собрать рекомендации — `POST /api/recommendations/generate`, посмотреть их с основаниями —
    `GET /api/recommendations`.
14. Открыть кабинет представителя вуза — `GET /api/portal/overview` под его учётной записью.
15. Посмотреть ленту событий вуза — `GET /api/universities/:id/events`.
16. Выпустить новую версию продукта — `GET`, затем `POST /api/products/:id/release`:
    одно действие ставит задачи во всех связках и переоткрывает закрытые этапы.

### Вход в систему

Аутентификация — NextAuth.js с сессиями на JWT, пароли хранятся хешами bcrypt.
Фронт входит через `signIn('credentials', { email, password })` из `next-auth/react`.

Демо-пользователи и общий пароль выводит `npm run db:seed`:

| Роль | Почта | Пароль |
| --- | --- | --- |
| ADMIN | `admin@skilllink.demo` | `skilllink` |
| MANAGER | `manager@skilllink.demo` | `skilllink` |
| ANALYST | `analyst@skilllink.demo` | `skilllink` |
| VIEWER | `viewer@skilllink.demo` | `skilllink` |
| UNIVERSITY_REP | `rep@spbgu.example.invalid` | `skilllink` |

Текущая роль и её права — `GET /api/me`. Справочник пользователей — `GET /api/users`.

### Быстрое переключение ролей в демо

Пока включён `DEMO_AUTH_ENABLED` (по умолчанию везде, кроме продакшена), пользователя
можно переключать без пароля — cookie `skilllink_user` с идентификатором:

```bash
curl -s http://localhost:3000/api/universities \
  -H "cookie: skilllink_user=ИДЕНТИФИКАТОР"
```

Настоящая сессия всегда важнее этой cookie. Под представителем вуза (`UNIVERSITY_REP`)
видно, что кабинет показывает только свой вуз, а аналитика и рекомендации закрыты.

**В промышленном контуре обязательно `DEMO_AUTH_ENABLED=false`** — иначе вход без пароля
остаётся открытым.

## Документация

| Документ | О чём |
| --- | --- |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | Контракт API: все эндпоинты, поля, ошибки, примеры |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Схема базы и решения по ней |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура и модули |
| [docs/ANALYTICS_METHODOLOGY.md](docs/ANALYTICS_METHODOLOGY.md) | Формулы, коэффициенты, ограничения |
| [docs/SECURITY_LIMITATIONS.md](docs/SECURITY_LIMITATIONS.md) | Что сделано по безопасности, чего нет |
| [docs/DESIGN_INTEGRATION.md](docs/DESIGN_INTEGRATION.md) | Связь экранов с API (черновик: макетов нет) |
| [docs/TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md) | Журнал технических решений |
| [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md) | Аудит стартовой точки |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Прогресс, риски, незавершённые задачи |

Источники требований: [docs/tz/skilllink-tz.md](docs/tz/skilllink-tz.md),
[docs/concept.md](docs/concept.md), правила работы — `CLAUDE.md`.

## Интеграции

Все интеграции настраиваются переменными окружения и по умолчанию выключены.
Состояние — `GET /api/integrations/status`.

| Переменная | Значение |
| --- | --- |
| `MARKET_DATA_PROVIDER` | `mock` (по умолчанию), `csv`, `external-api`, `future-rtk` |
| `MARKET_DATA_CSV_PATH` | путь к выгрузке для провайдера `csv` |
| `MARKET_DATA_API_URL`, `MARKET_DATA_API_TOKEN` | для провайдера `external-api` |
| `LMS_ENABLED`, `LMS_API_URL`, `LMS_API_TOKEN` | интеграция с LMS |
| `SITE_ENABLED`, `SITE_API_URL`, `SITE_API_TOKEN` | заявки с сайта |
| `INTEGRATION_TIMEOUT_MS`, `INTEGRATION_RETRIES` | таймаут и число повторов |

Загрузка рыночных данных активным источником:

```bash
curl -s -X POST http://localhost:3000/api/data-sources/sync -H 'content-type: application/json' -d '{"period":"2026-Q1"}'
```

Навыки, которых нет в справочнике, не создаются автоматически — они возвращаются списком
в `unknownSkills`. Сбой внешнего источника отдаёт `INTEGRATION_ERROR` 502 и не затрагивает
остальную систему.

Наличие конкретных внутренних API заказчика не утверждается: провайдер `future-rtk` честно
сообщает, что спецификация не предоставлена.

## Важное

- **Демонстрационные данные не выдаются за реальные.** Каждая запись и каждый аналитический
  ответ несут `isMock`, интерфейс обязан показывать пометку.
- **Нет данных — это `null`, а не ноль.** Незаполненный показатель приходит с `basis: "none"`
  и пояснением «Нет данных».
- **Соответствие 152-ФЗ и приказу ФСТЭК № 117 не заявляется.** Требования учитывались при
  проектировании; без отдельного аудита соответствие не утверждается. Подробности —
  в [SECURITY_LIMITATIONS.md](SECURITY_LIMITATIONS.md).
- **Авторизация на P0 — заглушка.** Стенд не выставлять в открытый доступ.

## Состав команды

- Артур — управление проектом, приёмка, `TODO: PM DECISION`
- Тигран — структура данных, миграции, справочники
- Иван, Сергей — интерфейс и дизайн
- Сергей — серверная часть, API, workflow, аналитика
