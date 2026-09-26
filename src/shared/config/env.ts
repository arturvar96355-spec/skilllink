import { z } from '@/shared/zod'

/**
 * Проверка окружения при старте сервера (решение 123).
 *
 * В промышленном режиме процесс не должен подниматься с секретом подписи,
 * который знают все (пустой, короткий, из примера или запасной разработческий),
 * и без базы: такой стенд «жив» для проверки живости, но каждый вход на нём —
 * либо подделываемая сессия, либо 500. Необязательные интеграции (бот, модель)
 * настроены наполовину — это предупреждение, а не отказ: основной контур
 * работает без них (решение 13).
 *
 * Проверка вызывается только из `src/instrumentation.ts` — при старте сервера
 * в среде Node и только при NODE_ENV=production. `next build` её не вызывает,
 * CI и сборка образа секретов не требуют.
 */

/** Короче этого секрет подписи не принимается: 32 знака — нижняя граница для HMAC-SHA-256. */
export const MIN_AUTH_SECRET_LENGTH = 32

/**
 * Значения, которые встречаются в репозитории, — их знает любой читавший код.
 * Сейчас это запасной секрет разработки (src/shared/auth/auth.ts, DEV_SECRET):
 * в `.env.example` секрет пустой, а пустой отвергается и так.
 */
export const KNOWN_EXAMPLE_SECRETS: readonly string[] = ['skilllink-dev-secret-not-for-production']

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim()

/** Что не так с секретом подписи сессий, или null. Одна причина — одна строка журнала. */
export function authSecretProblem(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (value === '') return 'не задан AUTH_SECRET'
  if (KNOWN_EXAMPLE_SECRETS.includes(value)) {
    return 'AUTH_SECRET совпадает с запасным значением из репозитория — его знает любой читавший код'
  }
  if (value.length < MIN_AUTH_SECRET_LENGTH) return `AUTH_SECRET короче ${MIN_AUTH_SECRET_LENGTH} знаков`
  if (new Set(value).size <= 4) return 'AUTH_SECRET из нескольких повторяющихся знаков'
  return null
}

/** Что не так с адресом базы, или null. */
export function databaseUrlProblem(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (value === '') return 'не задан DATABASE_URL'
  try {
    if (['postgresql:', 'postgres:'].includes(new URL(value).protocol)) return null
  } catch {
    // ниже
  }
  return 'DATABASE_URL — не адрес вида postgresql://…'
}

/** Схема обязательного в промышленном режиме. Сообщения — для журнала владельца сервера. */
const requiredSchema = z.object({
  AUTH_SECRET: z.string().optional().superRefine((value, ctx) => {
    const problem = authSecretProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
  DATABASE_URL: z.string().optional().superRefine((value, ctx) => {
    const problem = databaseUrlProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

export interface EnvironmentReport {
  /** Процесс не должен стартовать. */
  errors: string[]
  /** Работать можно, но что-то настроено наполовину или небезопасно для показа. */
  warnings: string[]
}

const TELEGRAM_SECRET = /^[A-Za-z0-9_-]{1,256}$/

/** Предупреждения по необязательным настройкам. */
function optionalWarnings(env: Record<string, string | undefined>): string[] {
  const warnings: string[] = []

  if (env.DEMO_AUTH_ENABLED === 'true' || env.DEMO_AUTH_ENABLED === '1') {
    warnings.push('DEMO_AUTH_ENABLED включён: вход без пароля по cookie. Только для показа, не для реальных данных')
  }

  const telegram = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'].map((name) => ({
    name,
    set: nonEmpty(env[name]) !== undefined,
  }))
  const telegramSet = telegram.filter((item) => item.set)
  if (telegramSet.length > 0 && telegramSet.length < telegram.length) {
    const missing = telegram.filter((item) => !item.set).map((item) => item.name)
    warnings.push(`Бот Telegram настроен наполовину — выключен, пока не заданы: ${missing.join(', ')}`)
  }
  const webhookSecret = nonEmpty(env.TELEGRAM_WEBHOOK_SECRET)
  if (webhookSecret && !TELEGRAM_SECRET.test(webhookSecret)) {
    warnings.push('TELEGRAM_WEBHOOK_SECRET: Telegram принимает 1–256 знаков A–Z, a–z, 0–9, _ и - — setWebhook его отвергнет')
  }

  const provider = nonEmpty(env.AI_ASSIST_PROVIDER)
  if (provider === 'yandexgpt' && (!nonEmpty(env.YANDEX_GPT_API_KEY) || !nonEmpty(env.YANDEX_FOLDER_ID))) {
    warnings.push('AI_ASSIST_PROVIDER=yandexgpt без YANDEX_GPT_API_KEY или YANDEX_FOLDER_ID — помощник пишет шаблоном')
  }
  if (provider === 'gigachat' && !nonEmpty(env.GIGACHAT_AUTH_KEY)) {
    warnings.push('AI_ASSIST_PROVIDER=gigachat без GIGACHAT_AUTH_KEY — помощник пишет шаблоном')
  }

  if (!nonEmpty(env.AUTH_URL) && !nonEmpty(env.APP_BASE_URL)) {
    warnings.push('Не задан ни AUTH_URL, ни APP_BASE_URL: ссылки в сводке Telegram и смена секрета вебхука не сработают')
  }
  return warnings
}

/** Чистая функция: окружение → ошибки и предупреждения. */
export function checkEnvironment(env: Record<string, string | undefined>): EnvironmentReport {
  const parsed = requiredSchema.safeParse({ AUTH_SECRET: env.AUTH_SECRET, DATABASE_URL: env.DATABASE_URL })
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  return { errors, warnings: optionalWarnings(env) }
}

/** Проверка нужна: промышленный режим, а не сборка. */
export function shouldCheckEnvironment(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production' && env.NEXT_PHASE !== 'phase-production-build'
}
