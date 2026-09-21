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

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  migrations: { seed: 'tsx prisma/seed.ts' },
})
