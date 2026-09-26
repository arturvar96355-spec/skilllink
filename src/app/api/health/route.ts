import { publicLiveness, type LivenessReport } from './report'
import { handle, ok } from '@/shared/http'

/**
 * Проверка живости: процесс жив и настроен. **Базу не трогает** (решение 118).
 *
 * На неё смотрит healthcheck контейнера (Dockerfile). Пока проверка живости ходила
 * в базу, остановка базы делала приложение «нездоровым», хотя оно само заработает,
 * как только база вернётся, — а Caddy при пересоздании ждёт здорового приложения
 * и не поднялся бы вовсе. Базу и миграции проверяет `/api/ready`.
 *
 * Настройка проверяется и здесь: без секрета подписи приложение стартует, но каждый
 * запрос падает на проверке прав, — такой процесс живым не считается.
 *
 * В продакшене совет наружу не уходит, только в журнал (report.ts).
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const production = process.env.NODE_ENV === 'production'
  const base = { uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() }

  const respond = (report: LivenessReport, status: number) => {
    if (report.hint && production) console.error('Проверка живости:', report.hint)
    return ok(publicLiveness(report, production), status)
  }

  if (production && !process.env.AUTH_SECRET?.trim()) {
    return respond(
      {
        status: 'misconfigured',
        ...base,
        hint:
          'Не задан AUTH_SECRET — приложение не сможет обслуживать запросы. Сгенерируйте: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      },
      503,
    )
  }

  if (!process.env.DATABASE_URL) {
    return respond(
      {
        status: 'misconfigured',
        ...base,
        hint: 'Не задана переменная DATABASE_URL. Скопируйте .env.example в .env и укажите строку подключения.',
      },
      503,
    )
  }

  return respond({ status: 'ok', ...base }, 200)
})
