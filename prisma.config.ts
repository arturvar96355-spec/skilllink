import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Конфигурация Prisma.
 *
 * Строка подключения читается напрямую из process.env, а не через `env()`:
 * `env()` бросает исключение, если переменной нет, а `prisma generate` подключение
 * к базе не нужно — клиент генерируется из схемы. Иначе `npm install` падал бы
 * до того, как заведён `.env`, и при сборке образа, где базы на этом шаге ещё нет.
 *
 * Командам миграции и интроспекции строка нужна: если её нет, Prisma скажет об этом сама.
 */
const databaseUrl = process.env.DATABASE_URL

/**
 * Команды, которым строка подключения действительно нужна.
 *
 * `generate` в список не входит: клиент собирается из схемы, база ему не нужна,
 * и требовать настройку на этом шаге значило бы ронять `npm install` до того,
 * как человек успел завести `.env`.
 */
const NEEDS_DATABASE = ['migrate', 'db', 'studio', 'seed']
const command = process.argv.slice(2).find((arg) => !arg.startsWith('-'))

if (!databaseUrl && command && NEEDS_DATABASE.includes(command)) {
  // Своё сообщение вместо «The datasource.url property is required»: по нему
  // непонятно ни что случилось, ни что делать, а это первый шаг установки.
  throw new Error(
    `Не задана переменная DATABASE_URL, а команде «prisma ${command}» она нужна.\n` +
      'Скопируйте .env.example в .env и укажите строку подключения к PostgreSQL:\n' +
      '  cp .env.example .env',
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  migrations: { seed: 'tsx prisma/seed.ts' },
})
