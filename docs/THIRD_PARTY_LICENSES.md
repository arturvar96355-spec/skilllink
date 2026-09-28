# Лицензии сторонних библиотек

Код SkillLink распространяется по лицензии [MIT](../LICENSE). Ниже — прямые зависимости
из `package.json` и их лицензии (по `license` в `package.json` каждой библиотеки,
версии — из `package-lock.json` на 28.09.2026). Все они разрешают использование,
изменение и распространение в составе закрытых и открытых продуктов.

## Работают в приложении (`dependencies`)

| Библиотека | Версия | Лицензия | Зачем |
| --- | --- | --- | --- |
| `next` | 15.5.25 | MIT | приложение и API в одном процессе |
| `react`, `react-dom` | 19.3.0 | MIT | интерфейс |
| `next-auth` | 5.0.0-beta.32 | ISC | вход: пароль, Keycloak (OpenID Connect), сессии |
| `bcryptjs` | 3.0.3 | BSD-3-Clause | хранение паролей |
| `@prisma/client`, `@prisma/adapter-pg` | 7.10.0 | Apache-2.0 | доступ к PostgreSQL |
| `pg` | 8.23.0 | MIT | драйвер PostgreSQL |
| `zod` | 4.6.5 | MIT | проверка входных данных каждого маршрута |
| `motion` | 13.4.2 | MIT | анимации дизайн-системы |
| `three` | 0.186.0 | MIT | декоративная 3D-сцена на странице входа |
| `swagger-ui-dist` | 5.33.0 | Apache-2.0 | Swagger UI на `/api-docs` |

Шрифт Inter подключается через `next/font/google` и встраивается при сборке —
лицензия SIL Open Font License 1.1.

## Только для разработки и сборки (`devDependencies`)

| Библиотека | Версия | Лицензия |
| --- | --- | --- |
| `typescript` | 5.9.3 | Apache-2.0 |
| `prisma` (CLI миграций) | 7.10.0 | Apache-2.0 |
| `vitest` | 4.1.11 | MIT |
| `eslint`, `eslint-config-next`, `@eslint/eslintrc` | 9.39.5 / 15.5.25 / 3.3.7 | MIT |
| `tsx` | 4.23.15 | MIT |
| `dotenv` | 18.0.1 | BSD-2-Clause |
| `@types/*` (node, react, react-dom, three, bcryptjs) | — | MIT |

## Всё дерево зависимостей приложения

В `package-lock.json` — 224 пакета без пометки `dev`. По лицензиям: MIT — 133,
Apache-2.0 — 39, ISC — 27, BSD-2/3-Clause — 5, 0BSD — 1, Unlicense — 2. Отдельно:

- `@img/sharp-*` (обработка картинок Next.js, `sharp`) — бинарные сборки libvips под
  **LGPL-3.0-or-later**: библиотека подключается динамически и не изменяется, что
  LGPL допускает без раскрытия кода приложения.
- `caniuse-lite` (данные о браузерах для сборки) — CC-BY-4.0.
- `elkjs` (EPL-2.0), `postgres` (Unlicense) — приходят вместе с инструментами Prisma
  (Prisma Studio), в работающее приложение не попадают.

Пересчитать самостоятельно: `npm ls --omit=dev --all` и поле `license` каждого пакета
в `package-lock.json`.
