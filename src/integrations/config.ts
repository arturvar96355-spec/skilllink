import { isIP } from 'node:net'

/**
 * Настройки интеграций. Всё берётся из переменных окружения — в коде секретов нет.
 *
 * По умолчанию интеграции выключены: система должна работать без них,
 * а их сбой не должен ломать основной контур.
 */

function readBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function readNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function readString(name: string): string | null {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? null : raw.trim()
}

/** Какой источник рыночных данных активен — переменная `MARKET_DATA_PROVIDER`. */
export const MARKET_DATA_PROVIDERS = ['mock', 'csv', 'external-api', 'future-rtk'] as const
export type MarketDataProviderKind = (typeof MARKET_DATA_PROVIDERS)[number]

function readProviderKind(): MarketDataProviderKind {
  const raw = readString('MARKET_DATA_PROVIDER') ?? 'mock'
  return (MARKET_DATA_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as MarketDataProviderKind)
    : 'mock'
}

/**
 * Провайдер ИИ-помощника (решение 90). По умолчанию выключен: помощник отдаёт
 * шаблонный текст из фактов правил, модель не вызывается.
 */
export const AI_ASSIST_PROVIDERS = ['off', 'yandexgpt', 'gigachat'] as const
export type AiAssistProviderKind = (typeof AI_ASSIST_PROVIDERS)[number]

function readAiAssistProvider(): AiAssistProviderKind {
  const raw = readString('AI_ASSIST_PROVIDER') ?? 'off'
  return (AI_ASSIST_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as AiAssistProviderKind)
    : 'off'
}

export interface AiAssistConfig {
  provider: AiAssistProviderKind
  /**
   * Свой таймаут, отдельно от INTEGRATION_TIMEOUT_MS: модель пишет текст секунды,
   * а не миллисекунды. Повторов нет — человек ждёт у кнопки, и шаблон лучше второй
   * попытки в полминуты.
   */
  timeoutMs: number
  yandexGpt: {
    apiKey: string | null
    folderId: string | null
    model: string
  }
  gigaChat: {
    authKey: string | null
    scope: string
    model: string
    /** Сертификат НУЦ Минцифры: без него TLS до GigaChat не проходит. */
    caCertPath: string | null
  }
}

/**
 * Бот личных уведомлений в Telegram (решение 102). Выключен, пока не задан токен:
 * блок в профиле пишет «Не настроено администратором», вебхук ничего не делает.
 */
export interface TelegramConfig {
  /** Токен от BotFather. Секрет: только в env, в журнал и в ответы не попадает. */
  botToken: string | null
  /** Имя бота без @ — для ссылки t.me/<имя>?start=<токен привязки>. */
  botUsername: string | null
  /** Значение заголовка X-Telegram-Bot-Api-Secret-Token, заданное в setWebhook. */
  webhookSecret: string | null
  /** База Bot API без завершающего слэша. */
  apiBase: string
  /**
   * IP, на который идёт соединение с Bot API, если имя из apiBase недоступно
   * (из Yandex Cloud — 149.154.167.220). SNI и Host остаются из apiBase.
   */
  apiIp: string | null
  timeoutMs: number
  /** Бот работает: есть и токен, и имя, и секрет вебхука. */
  enabled: boolean
}

export const TELEGRAM_DEFAULT_API_BASE = 'https://api.telegram.org'

/** База Bot API: только http(s)-адрес, иначе — адрес по умолчанию. */
function readTelegramApiBase(): string {
  const raw = readString('TELEGRAM_API_BASE')
  if (!raw) return TELEGRAM_DEFAULT_API_BASE
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return TELEGRAM_DEFAULT_API_BASE
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return TELEGRAM_DEFAULT_API_BASE
  }
}

/** Только IP: имя здесь теряет смысл — ради обхода DNS переменная и заведена. */
function readTelegramApiIp(): string | null {
  const raw = readString('TELEGRAM_API_IP')
  return raw && isIP(raw) !== 0 ? raw : null
}

function readTelegramConfig(timeoutMs: number): TelegramConfig {
  const botToken = readString('TELEGRAM_BOT_TOKEN')
  const botUsername = readString('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') ?? null
  const webhookSecret = readString('TELEGRAM_WEBHOOK_SECRET')
  return {
    botToken,
    botUsername,
    webhookSecret,
    apiBase: readTelegramApiBase(),
    apiIp: readTelegramApiIp(),
    timeoutMs,
    enabled: botToken !== null && botUsername !== null && webhookSecret !== null,
  }
}

export interface IntegrationCommonConfig {
  timeoutMs: number
  retries: number
  /** Минимальный интервал между запросами к одному внешнему сервису, мс. */
  minIntervalMs: number
}

export interface RemoteServiceConfig {
  enabled: boolean
  baseUrl: string | null
  token: string | null
}

export interface IntegrationsConfig {
  common: IntegrationCommonConfig
  marketData: {
    kind: MarketDataProviderKind
    csvPath: string | null
    apiUrl: string | null
    apiToken: string | null
  }
  lms: RemoteServiceConfig
  site: RemoteServiceConfig
  aiAssist: AiAssistConfig
  telegram: TelegramConfig
}

/**
 * Читается при каждом обращении, а не один раз на импорт: так переменные окружения
 * можно поменять без пересборки, а тесты не зависят от порядка импортов.
 */
export function getIntegrationsConfig(): IntegrationsConfig {
  const common: IntegrationCommonConfig = {
    timeoutMs: readNumber('INTEGRATION_TIMEOUT_MS', 5000),
    retries: readNumber('INTEGRATION_RETRIES', 2),
    minIntervalMs: readNumber('INTEGRATION_MIN_INTERVAL_MS', 200),
  }
  return {
    common,
    marketData: {
      kind: readProviderKind(),
      csvPath: readString('MARKET_DATA_CSV_PATH'),
      apiUrl: readString('MARKET_DATA_API_URL'),
      apiToken: readString('MARKET_DATA_API_TOKEN'),
    },
    lms: {
      enabled: readBoolean('LMS_ENABLED'),
      baseUrl: readString('LMS_API_URL'),
      token: readString('LMS_API_TOKEN'),
    },
    site: {
      enabled: readBoolean('SITE_ENABLED'),
      baseUrl: readString('SITE_API_URL'),
      token: readString('SITE_API_TOKEN'),
    },
    aiAssist: {
      provider: readAiAssistProvider(),
      timeoutMs: readNumber('AI_ASSIST_TIMEOUT_MS', 15000),
      yandexGpt: {
        apiKey: readString('YANDEX_GPT_API_KEY'),
        folderId: readString('YANDEX_FOLDER_ID'),
        model: readString('YANDEX_GPT_MODEL') ?? 'yandexgpt-lite',
      },
      gigaChat: {
        authKey: readString('GIGACHAT_AUTH_KEY'),
        scope: readString('GIGACHAT_SCOPE') ?? 'GIGACHAT_API_PERS',
        model: readString('GIGACHAT_MODEL') ?? 'GigaChat',
        caCertPath: readString('GIGACHAT_CA_CERT_PATH'),
      },
    },
    telegram: readTelegramConfig(common.timeoutMs),
  }
}
