import { prisma } from '@/shared/db/prisma'
import { handle, ok } from '@/shared/http'

/**
 * Проверка живости приложения.
 *
 * Проверяется не только соединение, но и то, что схема применена: пустая база
 * отвечает на `SELECT 1` как ни в чём не бывало, и контейнер рапортовал бы «здоров»,
 * пока приложение на деле неработоспособно.
 */
export const GET = handle(async () => {
  await prisma.$queryRaw`SELECT 1`

  let schemaReady = true
  try {
    // Любая таблица из миграций: если её нет, миграции не применены.
    await prisma.user.count()
  } catch {
    schemaReady = false
  }

  const body = {
    status: schemaReady ? 'ok' : 'degraded',
    database: 'connected',
    schema: schemaReady ? 'ready' : 'missing',
    ...(schemaReady ? {} : { hint: 'Примените миграции: npm run db:deploy' }),
    time: new Date().toISOString(),
  }

  // Неприменённые миграции — это не «здоров»: пусть оркестратор видит проблему.
  return ok(body, schemaReady ? 200 : 503)
})
