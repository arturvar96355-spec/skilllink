import { prisma } from '@/shared/db/prisma'
import { handle, ok } from '@/shared/http'

/**
 * Проверка живости приложения.
 *
 * Сюда смотрят, когда что-то не работает, — значит, ответ обязан называть причину,
 * а не сообщать «внутренняя ошибка». Различаются три состояния, и у каждого свой
 * совет: не задана настройка, база недоступна, схема не применена.
 *
 * Схема проверяется отдельно от соединения: пустая база отвечает на `SELECT 1`
 * как ни в чём не бывало, и контейнер рапортовал бы «здоров», пока приложение
 * на деле неработоспособно.
 */
export const GET = handle(async () => {
  const now = () => new Date().toISOString()

  if (!process.env.DATABASE_URL) {
    return ok(
      {
        status: 'misconfigured',
        database: 'not-configured',
        schema: 'unknown',
        hint: 'Не задана переменная DATABASE_URL. Скопируйте .env.example в .env и укажите строку подключения.',
        time: now(),
      },
      503,
    )
  }

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    return ok(
      {
        status: 'degraded',
        database: 'unreachable',
        schema: 'unknown',
        hint: 'База недоступна. Проверьте, что PostgreSQL запущен и DATABASE_URL указывает на него: docker compose up -d postgres',
        time: now(),
      },
      503,
    )
  }

  let schemaReady = true
  try {
    // Любая таблица из миграций: если её нет, миграции не применены.
    await prisma.user.count()
  } catch {
    schemaReady = false
  }

  return ok(
    {
      status: schemaReady ? 'ok' : 'degraded',
      database: 'connected',
      schema: schemaReady ? 'ready' : 'missing',
      ...(schemaReady ? {} : { hint: 'Примените миграции: npm run db:deploy' }),
      time: now(),
    },
    // Неприменённые миграции — это не «здоров»: пусть оркестратор видит проблему.
    schemaReady ? 200 : 503,
  )
})
