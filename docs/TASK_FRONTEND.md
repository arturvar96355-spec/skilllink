# Задание фронту — SkillLink

Ване и Серёже. Серверная часть готова: 53 эндпоинта, все проверены. Ниже всё, что нужно,
чтобы начать сегодня.

---

## 0. Что нужно получить

**Доступ к репозиторию.** Это важно: интерфейс живёт **внутри того же проекта**, что и
серверная часть. Вы не подключаетесь к чужому API по сети — вы пишете страницы в `src/app/`
рядом с готовыми маршрутами. Одних документов недостаточно, нужен сам код.

Если репозитория ещё нет на GitHub — попросите Сергея его выложить.

---

## 1. Запуск за пять минут

```bash
git clone <репозиторий> && cd skilllink
npm install
cp .env.example .env          # менять нужно только DATABASE_URL
npm run db:migrate
npm run db:seed
npm run dev
```

Нужен PostgreSQL 16+. Нет под рукой — поднимется из репозитория:
`docker compose up -d` (если 5432 занят: `POSTGRES_PORT=5433 docker compose up -d`).

Проверка: откройте `http://localhost:3000/api/health` — должно быть
`{"data":{"status":"ok","schema":"ready",...}}`.

Если увидите `503` и `schema: "missing"` — не применены миграции, выполните `npm run db:migrate`.

---

## 2. Где что лежит

```
src/
  app/                    ← ВАША ЗОНА: страницы и вёрстка
    layout.tsx            уже есть, в нём подключён SessionProvider
    page.tsx              заглушка — замените своей главной
    providers.tsx         обёртки для клиентских компонентов
    api/**/route.ts       НЕ ТРОГАТЬ: это серверная часть
  shared/contracts/       ← типы и подписи, импортируйте отсюда
  modules/                бизнес-логика, вам не нужна
```

Ставьте страницы в `src/app/`. Компоненты — как вам удобно, например `src/components/`.
Структуру `src/modules` и `src/app/api` менять не нужно.

---

## 3. Как звать API

Проект — монолит, поэтому есть два способа. **Используйте первый.**

### Из клиентских компонентов — обычный fetch по относительному пути

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { UniversityListItemDto, ApiListResponse } from '@/shared/contracts'

export function UniversityList() {
  const [items, setItems] = useState<UniversityListItemDto[]>([])

  useEffect(() => {
    fetch('/api/universities?pageSize=20')
      .then((r) => r.json())
      .then((body: ApiListResponse<UniversityListItemDto>) => setItems(body.data))
  }, [])

  return <ul>{items.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
}
```

### Из серверных компонентов — тоже fetch, но с абсолютным адресом

```tsx
import type { ApiListResponse, UniversityListItemDto } from '@/shared/contracts'

export default async function Page() {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  const response = await fetch(`${base}/api/universities`, { cache: 'no-store' })
  const body: ApiListResponse<UniversityListItemDto> = await response.json()
  return <div>{body.data.length}</div>
}
```

**Не вызывайте сервисы из `src/modules` напрямую**, даже если IDE подскажет. Технически
это возможно, но тогда вы обойдёте проверку прав и валидацию, которые живут в маршрутах,
и поведение страницы разойдётся с поведением API. Всегда через HTTP.

---

## 4. Типы и подписи — только из `@/shared/contracts`

```ts
import type { CooperationDto, UniversityListItemDto, Metric } from '@/shared/contracts'
import { STAGE_STATUS_LABELS, COOPERATION_STATUS_LABELS } from '@/shared/contracts'
```

**Ничего не импортируйте из `@/generated/prisma`** — это структура таблиц, она меняется
вместе со схемой базы.

**Русские подписи к статусам тоже берите отсюда.** API отдаёт коды (`IN_PROGRESS`),
словари подписей лежат рядом с типами:

```tsx
STAGE_STATUS_LABELS[stage.status]          // «В работе»
COOPERATION_STATUS_LABELS[coop.status]     // «Завершена»
PROGRAM_LEVEL_LABELS[program.level]        // «Бакалавриат»
```

Не пишите свои: теми же словами сервер подписывает обоснования рекомендаций, ленту событий
и выгрузку CSV. Разойдутся — пользователь увидит в одном месте «В работе», в другом «Идёт».

---

## 5. Формат ответов

**Один объект:**
```json
{ "data": { "id": "…", "name": "…" } }
```

**Список:**
```json
{ "data": [...], "meta": { "page": 1, "pageSize": 20, "total": 137 } }
```

**Ошибка:**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Ошибка валидации данных",
             "details": [ { "field": "name", "message": "…" } ] } }
```

`message` уже на русском — показывайте как есть. При `VALIDATION_ERROR` в `details`
лежит массив `{ field, message }`: подсвечивайте конкретные поля формы.

| Код | HTTP | Что показать |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | подсветить поля из `details` |
| `UNAUTHORIZED` | 401 | отправить на вход |
| `FORBIDDEN` | 403 | «недостаточно прав», не показывать раздел вовсе |
| `NOT_FOUND` | 404 | «запись не найдена» |
| `CONFLICT` / `INVALID_TRANSITION` | 409 | текст ошибки, действие недоступно |
| `INTEGRATION_ERROR` | 502 | «внешний сервис недоступен», остальное работает |
| `INTERNAL` | 500 | общее сообщение |

---

## 6. Четыре правила, которые сэкономят время

### Показатели — объекты, а не числа

```ts
program.metrics.studentCount
// { value: 124, unit: 'человек', basis: 'actual', explanation: '…', isMock: true }
```

При `basis: "none"` значение равно `null` — показывайте **«Нет данных», а не 0**.
Это требование ТЗ, а не пожелание. `explanation` годится для подсказки при наведении.

### `isMock` обязателен к показу

Все демонстрационные данные помечены. Выдавать их за подтверждённую статистику запрещено
разделом 4 ТЗ. На дашборде для этого есть общий признак `containsMockData`.

### Права приходят готовыми

```ts
const me = await fetch('/api/me').then(r => r.json())
me.data.permissions  // { canWrite, canSeeAnalytics, canUsePortal, isAdmin }
```

По ним решайте, какие разделы рисовать. Матрицу доступа у себя не дублируйте.

### Ответ на изменение приходит целиком

`PATCH` этапа и задачи возвращает **этап целиком**, `PATCH` связки — **связку целиком**.
Второй запрос за свежими данными не нужен.

---

## 7. Вход в систему

Аутентификация — NextAuth.js. В `layout.tsx` уже подключён `SessionProvider`.

```tsx
'use client'
import { signIn, signOut, useSession } from 'next-auth/react'

export function LoginForm() {
  const { data: session, status } = useSession()

  if (status === 'loading') return <p>Загрузка…</p>
  if (session) return <button onClick={() => signOut()}>Выйти</button>

  return (
    <button onClick={() => signIn('credentials', { email, password, callbackUrl: '/' })}>
      Войти
    </button>
  )
}
```

Пока своей страницы входа нет, работает встроенная: `http://localhost:3000/api/auth/signin`.
Когда сделаете свою по адресу `/login` — скажите Сергею, он вернёт настройку
`pages: { signIn: '/login' }`, и перенаправления пойдут на неё.

**Демо-пользователи** (пароль у всех `skilllink`, идентификаторы печатает `npm run db:seed`):

| Роль | Почта | Что проверять |
| --- | --- | --- |
| MANAGER | `manager@skilllink.demo` | основной сценарий |
| ANALYST | `analyst@skilllink.demo` | аналитика без права изменения |
| UNIVERSITY_REP | `rep@spbgu.example.invalid` | кабинет вуза |
| ADMIN | `admin@skilllink.demo` | журнал действий |

Роли можно переключать и без пароля — cookie `skilllink_user` с идентификатором
(работает, пока включён `DEMO_AUTH_ENABLED`). Удобно для отладки.

---

## 8. Что обязательно предусмотреть в интерфейсе

| Ситуация | Что придёт | Что показать |
| --- | --- | --- |
| Завершение этапа без результата | 422 | форму с полем «Результат» |
| Завершение этапа с открытыми пунктами | 409 | сколько обязательных пунктов осталось |
| Блокировка этапа | 422 без `blockingReason` | обязательное поле «Причина» |
| Отмена или переоткрытие этапа | 422 без `comment` | обязательное поле «Основание» |
| Этап 14 | `isAutoManaged: true` | только чтение, никаких кнопок |
| Двойной клик по кнопке | 409 «изменено другим пользователем» | «обновите страницу» |
| Отклонение рекомендации | 422 без `comment` | обязательное поле |
| Архивирование вуза со связками | 409 + `details.openCooperations` | понятный текст, не «ошибка» |

И четыре состояния у каждого экрана: **загрузка**, **ошибка**, **пусто**, **данные**.

---

## 9. Экраны

### Из ТЗ (разделы 7.1–7.6)

| Экран | Основной запрос |
| --- | --- |
| Дашборд | `GET /api/analytics/overview` — один запрос на всё |
| Реестр вузов | `GET /api/universities` |
| Карточка вуза | `GET /api/universities/:id` + вкладки: программы, связи, документы, встречи, история |
| Программы | `GET /api/programs`, `GET /api/programs/:id` |
| Рекомендации | `GET /api/recommendations` |
| Сотрудничество | `GET /api/cooperations/:id` — связка со всеми 14 этапами |

### Которых, скорее всего, нет в ваших макетах

API под них готов и проверен:

- **Вход** — форма почта + пароль.
- **Кабинет представителя вуза** — `/api/portal/*`. Отдельная роль: видит только свой вуз,
  подтверждает получение материалов, вносит численность и группы, подаёт заявки.
  **Аналитику, рейтинги и рекомендации ему показывать нельзя** — сервер их не отдаст (403).
- **Лента событий вуза** — `/api/universities/:id/events`.
- **Выгрузка и загрузка CSV** — `/api/export`, `/api/import`.
- **Состояние интеграций** — `/api/integrations/status`, для администратора.

Подробная раскладка «какой блок из какого поля» — в `docs/DESIGN_INTEGRATION.md`.

---

## 10. Справочники

| Что | Где |
| --- | --- |
| Машиночитаемый контракт | `docs/openapi.json` и `GET /api/openapi.json` |
| Все эндпоинты с полями и примерами | `docs/API_CONTRACT.md` |
| Связь экранов с API | `docs/DESIGN_INTEGRATION.md` |

По `openapi.json` генерируется типизированный клиент — руками описывать запросы не нужно.

---

## 11. Что нужно от вас

1. **Положите экспорт макетов в `docs/design/`.** Сейчас `DESIGN_INTEGRATION.md` составлен
   по экранам ТЗ, а не по вашим. Пока макетов нет, расхождения не видны — а вскроются они
   на подключении, когда переделывать дороже всего.
2. **Скажите, если чего-то не хватает в API.** Например, если в макете карточки программы
   показаны IT-продукты напрямую — сейчас связь идёт через сотрудничества, и нужен
   отдельный эндпоинт. Такое лучше найти сейчас, а не в последний день.
3. **Не меняйте** `src/app/api/**`, `src/modules/**` и `src/shared/contracts/**` —
   если нужно новое поле в ответе, скажите, добавлю и обновлю контракт.
