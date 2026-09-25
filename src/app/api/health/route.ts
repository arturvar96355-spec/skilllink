import { prisma } from '@/shared/db/prisma'
import { diagnoseDatabaseError } from '@/shared/db/database-error'
import { publicHealth, type HealthReport } from './report'
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
 *
 * В продакшене совет наружу не уходит, только в журнал (report.ts): по нему
 * прохожий узнал бы, что именно сломано в настройке стенда.
 */
export const GET = handle(async () => {
  const production = process.env.NODE_ENV === 'production'
  const now = () => new Date().toISOString()

  const respond = (report: HealthReport, status: number) => {
    if (report.hint && production) console.error('Проверка живости:', report.hint)
    return ok(publicHealth(report, production), status)
  }

  // Приложение без секрета подписи стартует, но каждый запрос падает на проверке
  // прав: сессию не прочитать. Проверка живости обязана это видеть — иначе
  // контейнер считается здоровым, оркестратор пускает на него трафик,
  // а пользователь получает 500 на всём, кроме самой проверки живости.
  const secretMissing = production && !process.env.AUTH_SECRET?.trim()

  if (secretMissing) {
    return respond(
      {
        status: 'misconfigured',
        database: 'unknown',
        schema: 'unknown',
        hint:
          'Не задан AUTH_SECRET — приложение не сможет обслуживать запросы. Сгенерируйте: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
        time: now(),
      },
      503,
    )
  }

  if (!process.env.DATABASE_URL) {
    return respond(
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
  } catch (error) {
    // В журнал — целиком: подсказка отвечает на «что делать», а разбираться
    // в неожиданном сбое всё равно придётся по настоящей ошибке.
    console.error('Проверка живости: база не ответила', error)
    const { database, hint } = diagnoseDatabaseError(error)
    return respond({ status: 'degraded', database, schema: 'unknown', hint, time: now() }, 503)
  }

  let schemaReady = true
  try {
    // Любая таблица из миграций: если её нет, миграции не применены.
    await prisma.user.count()
  } catch {
    schemaReady = false
  }

  return respond(
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
