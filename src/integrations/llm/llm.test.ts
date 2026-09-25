import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catchError } from '@/shared/testing/expect-code'
import { getIntegrationsConfig } from '../config'
import { resetRateLimiter } from '../http-client'
import {
  DisabledLlmProvider,
  GIGACHAT_COMPLETIONS_URL,
  GIGACHAT_OAUTH_URL,
  GigaChatProvider,
  YANDEX_GPT_URL,
  YandexGptProvider,
  createHttpsTransport,
  getLlmProvider,
  llmFailureKind,
  parseGigaChatResponse,
  parseYandexGptResponse,
  resetGigaChatToken,
  type HttpsTransport,
} from '.'
import type { HttpsPostRequest } from './https-transport'

/**
 * Провайдеры ИИ-помощника. Настоящей сети здесь нет: fetch и HTTPS подменены,
 * проверяется, что уходит наружу и как разбирается ответ.
 */

const TOUCHED = [
  'AI_ASSIST_PROVIDER',
  'AI_ASSIST_TIMEOUT_MS',
  'YANDEX_GPT_API_KEY',
  'YANDEX_FOLDER_ID',
  'YANDEX_GPT_MODEL',
  'GIGACHAT_AUTH_KEY',
  'GIGACHAT_SCOPE',
  'GIGACHAT_MODEL',
  'GIGACHAT_CA_CERT_PATH',
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]))
  for (const name of TOUCHED) delete process.env[name]
  resetRateLimiter()
  resetGigaChatToken()
})

afterEach(() => {
  for (const name of TOUCHED) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  vi.unstubAllGlobals()
})

const REQUEST = { system: 'Инструкция', user: 'Факты' }

const yandexSettings = { apiKey: 'test-api-key', folderId: 'b1gfolder', model: 'yandexgpt-lite' }

function yandexAnswer(text: string, status = 'ALTERNATIVE_STATUS_FINAL') {
  return {
    result: {
      alternatives: [{ message: { role: 'assistant', text }, status }],
      usage: { inputTextTokens: '10', completionTokens: '5', totalTokens: '15' },
      modelVersion: '23.10.2024',
    },
  }
}

describe('настройки помощника', () => {
  it('по умолчанию выключен', () => {
    expect(getIntegrationsConfig().aiAssist.provider).toBe('off')
    expect(getLlmProvider()).toBeInstanceOf(DisabledLlmProvider)
    expect(getLlmProvider().info().ready).toBe(false)
  })

  it('неизвестное значение не включает модель', () => {
    process.env.AI_ASSIST_PROVIDER = 'chatgpt'
    expect(getIntegrationsConfig().aiAssist.provider).toBe('off')
  })

  it('таймаут свой, по умолчанию 15 секунд', () => {
    expect(getIntegrationsConfig().aiAssist.timeoutMs).toBe(15000)
    process.env.AI_ASSIST_TIMEOUT_MS = '4000'
    expect(getIntegrationsConfig().aiAssist.timeoutMs).toBe(4000)
  })

  it('модели по умолчанию — yandexgpt-lite и GigaChat, область — GIGACHAT_API_PERS', () => {
    const { yandexGpt, gigaChat } = getIntegrationsConfig().aiAssist
    expect(yandexGpt.model).toBe('yandexgpt-lite')
    expect(gigaChat.model).toBe('GigaChat')
    expect(gigaChat.scope).toBe('GIGACHAT_API_PERS')
  })

  it('YandexGPT без ключа или каталога не готов и говорит, чего не хватает', () => {
    process.env.AI_ASSIST_PROVIDER = 'yandexgpt'
    process.env.YANDEX_GPT_API_KEY = 'key'
    const provider = getLlmProvider()
    expect(provider).toBeInstanceOf(YandexGptProvider)
    expect(provider.info().ready).toBe(false)
    expect(provider.info().reason).toContain('YANDEX_FOLDER_ID')
  })

  it('GigaChat выбирается переменной и без ключа не готов', () => {
    process.env.AI_ASSIST_PROVIDER = 'gigachat'
    const provider = getLlmProvider()
    expect(provider).toBeInstanceOf(GigaChatProvider)
    expect(provider.info().ready).toBe(false)
    expect(provider.info().reason).toContain('GIGACHAT_AUTH_KEY')
  })

  it('выключенный провайдер не ходит в сеть', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new DisabledLlmProvider().generate()).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ответ YandexGPT', () => {
  it('текст — из result.alternatives[0].message.text', () => {
    expect(parseYandexGptResponse(yandexAnswer('  Сводка готова.  '))).toBe('Сводка готова.')
  })

  it('чужой формат — ошибка, а не пустой черновик', () => {
    expect(() => parseYandexGptResponse({ result: { alternatives: [] } })).toThrow()
    expect(() => parseYandexGptResponse({ error: 'bad' })).toThrow()
    expect(llmFailureKind(catchError(() => parseYandexGptResponse(null)))).toBe('error')
  })

  it('пустой текст и отказ фильтра — «пусто»', () => {
    expect(llmFailureKind(catchError(() => parseYandexGptResponse(yandexAnswer('   '))))).toBe('empty')
    expect(
      llmFailureKind(
        catchError(() =>
          parseYandexGptResponse(yandexAnswer('Я не могу обсуждать эту тему', 'ALTERNATIVE_STATUS_CONTENT_FILTER')),
        ),
      ),
    ).toBe('empty')
  })

  it('запрос: адрес, Api-Key, каталог, modelUri, температура и роли', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(yandexAnswer('Готово')), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new YandexGptProvider(yandexSettings, 1000, 0)
    const completion = await provider.generate(REQUEST)
    expect(completion).toEqual({ text: 'Готово', model: 'yandexgpt-lite' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(YANDEX_GPT_URL)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Api-Key test-api-key')
    expect(headers['x-folder-id']).toBe('b1gfolder')
    expect(headers['x-data-logging-enabled']).toBe('false')
    expect(JSON.parse(String(init.body))).toEqual({
      modelUri: 'gpt://b1gfolder/yandexgpt-lite/latest',
      completionOptions: { stream: false, temperature: 0.3, maxTokens: '800' },
      messages: [
        { role: 'system', text: 'Инструкция' },
        { role: 'user', text: 'Факты' },
      ],
    })
  })

  it('HTTP-ошибка — одна попытка, без повторов, вид «ошибка»', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const error = await new YandexGptProvider(yandexSettings, 1000, 0).generate(REQUEST).catch((caught) => caught)
    expect(llmFailureKind(error)).toBe('error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не уложился в таймаут — вид «таймаут»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const aborted = new Error('This operation was aborted')
              aborted.name = 'AbortError'
              reject(aborted)
            })
          }),
      ),
    )
    const error = await new YandexGptProvider(yandexSettings, 20, 0).generate(REQUEST).catch((caught) => caught)
    expect(llmFailureKind(error)).toBe('timeout')
  })

  it('без ключа в сеть не ходит', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = new YandexGptProvider({ ...yandexSettings, apiKey: null }, 1000, 0)
    await expect(provider.generate(REQUEST)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

const gigaSettings = {
  authKey: 'base64-auth-key',
  scope: 'GIGACHAT_API_PERS',
  model: 'GigaChat',
  caCertPath: null,
}

function gigaTransport(options: { completionStatus?: number; content?: string; expiresInMs?: number } = {}) {
  const calls: HttpsPostRequest[] = []
  const transport: HttpsTransport = async (request) => {
    calls.push(request)
    if (request.url === GIGACHAT_OAUTH_URL) {
      return {
        status: 200,
        body: JSON.stringify({
          access_token: `token-${calls.length}`,
          expires_at: Date.now() + (options.expiresInMs ?? 30 * 60_000),
        }),
      }
    }
    return {
      status: options.completionStatus ?? 200,
      body: JSON.stringify({
        model: 'GigaChat:1.0.26.20',
        choices: [{ message: { role: 'assistant', content: options.content ?? 'Черновик' }, finish_reason: 'stop' }],
      }),
    }
  }
  return { transport, calls }
}

describe('ответ GigaChat', () => {
  it('текст — из choices[0].message.content', () => {
    expect(
      parseGigaChatResponse({ model: 'GigaChat', choices: [{ message: { content: ' Письмо ' } }] }),
    ).toEqual({ text: 'Письмо', model: 'GigaChat' })
  })

  it('чужой формат — ошибка; пустота и отказ фильтра — «пусто»', () => {
    expect(llmFailureKind(catchError(() => parseGigaChatResponse({ choices: [] })))).toBe('error')
    expect(
      llmFailureKind(catchError(() => parseGigaChatResponse({ choices: [{ message: { content: '' } }] }))),
    ).toBe('empty')
    expect(
      llmFailureKind(
        catchError(() =>
          parseGigaChatResponse({ choices: [{ message: { content: 'Не могу' }, finish_reason: 'blacklist' }] }),
        ),
      ),
    ).toBe('empty')
  })

  it('сначала токен по ключу авторизации, потом запрос к модели с Bearer', async () => {
    const { transport, calls } = gigaTransport()
    const completion = await new GigaChatProvider(gigaSettings, 1000, transport).generate(REQUEST)

    expect(completion).toEqual({ text: 'Черновик', model: 'GigaChat:1.0.26.20' })
    expect(calls.map((call) => call.url)).toEqual([GIGACHAT_OAUTH_URL, GIGACHAT_COMPLETIONS_URL])

    const [oauth, chat] = calls
    expect(oauth!.headers.authorization).toBe('Basic base64-auth-key')
    expect(oauth!.headers.RqUID).toMatch(/^[0-9a-f-]{36}$/)
    expect(oauth!.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(oauth!.body).toBe('scope=GIGACHAT_API_PERS')

    expect(chat!.headers.authorization).toBe('Bearer token-1')
    expect(JSON.parse(chat!.body)).toEqual({
      model: 'GigaChat',
      messages: [
        { role: 'system', content: 'Инструкция' },
        { role: 'user', content: 'Факты' },
      ],
      temperature: 0.3,
    })
  })

  it('токен кэшируется до истечения', async () => {
    const { transport, calls } = gigaTransport()
    const provider = new GigaChatProvider(gigaSettings, 1000, transport)
    await provider.generate(REQUEST)
    await provider.generate(REQUEST)
    expect(calls.filter((call) => call.url === GIGACHAT_OAUTH_URL)).toHaveLength(1)
  })

  it('истекающий токен запрашивается заново', async () => {
    const { transport, calls } = gigaTransport({ expiresInMs: 30_000 })
    const provider = new GigaChatProvider(gigaSettings, 1000, transport)
    await provider.generate(REQUEST)
    await provider.generate(REQUEST)
    expect(calls.filter((call) => call.url === GIGACHAT_OAUTH_URL)).toHaveLength(2)
  })

  it('401 от модели сбрасывает токен', async () => {
    const failing = gigaTransport({ completionStatus: 401 })
    const provider = new GigaChatProvider(gigaSettings, 1000, failing.transport)
    await expect(provider.generate(REQUEST)).rejects.toThrow()
    await expect(provider.generate(REQUEST)).rejects.toThrow()
    expect(failing.calls.filter((call) => call.url === GIGACHAT_OAUTH_URL)).toHaveLength(2)
  })

  it('сертификат из GIGACHAT_CA_CERT_PATH уходит в оба запроса', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skilllink-ca-'))
    const path = join(dir, 'russian_trusted_root_ca.pem')
    await writeFile(path, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n')

    const { transport, calls } = gigaTransport()
    await new GigaChatProvider({ ...gigaSettings, caCertPath: path }, 1000, transport).generate(REQUEST)
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(String(call.ca)).toContain('TEST')
  })

  it('нечитаемый сертификат — ошибка, в сеть не ходим', async () => {
    const { transport, calls } = gigaTransport()
    const provider = new GigaChatProvider({ ...gigaSettings, caCertPath: '/nonexistent/ca.pem' }, 1000, transport)
    await expect(provider.generate(REQUEST)).rejects.toThrow('сертификат')
    expect(calls).toHaveLength(0)
  })
})

/** Поддельный `https.request`: сети нет, ответ — из теста. */
function fakeRequest(reply: { status: number; body: string } | null) {
  const captured: { options?: Record<string, unknown>; body?: string } = {}
  const requestFn = ((options: Record<string, unknown>, callback: (response: EventEmitter) => void) => {
    captured.options = options
    const request = new EventEmitter() as EventEmitter & {
      destroy: (error: Error) => void
      end: (body: string) => void
    }
    request.destroy = (error) => request.emit('error', error)
    request.end = (body) => {
      captured.body = body
      if (!reply) return
      const response = Object.assign(new EventEmitter(), { statusCode: reply.status })
      callback(response)
      setImmediate(() => {
        response.emit('data', Buffer.from(reply.body))
        response.emit('end')
      })
    }
    return request
  }) as unknown as Parameters<typeof createHttpsTransport>[0]
  return { requestFn, captured }
}

describe('HTTPS-транспорт GigaChat', () => {
  it('передаёт сертификат в опцию ca и отдаёт статус с телом', async () => {
    const { requestFn, captured } = fakeRequest({ status: 200, body: '{"ok":true}' })
    const response = await createHttpsTransport(requestFn)({
      url: GIGACHAT_OAUTH_URL,
      headers: { accept: 'application/json' },
      body: 'scope=X',
      timeoutMs: 1000,
      ca: 'PEM',
    })
    expect(response).toEqual({ status: 200, body: '{"ok":true}' })
    expect(captured.options).toMatchObject({
      hostname: 'ngw.devices.sberbank.ru',
      port: 9443,
      path: '/api/v2/oauth',
      method: 'POST',
      ca: 'PEM',
    })
    expect(captured.body).toBe('scope=X')
  })

  it('без сертификата опции ca нет — стандартный набор доверенных центров', async () => {
    const { requestFn, captured } = fakeRequest({ status: 200, body: '{}' })
    await createHttpsTransport(requestFn)({
      url: GIGACHAT_COMPLETIONS_URL,
      headers: {},
      body: '{}',
      timeoutMs: 1000,
      ca: null,
    })
    expect(captured.options).not.toHaveProperty('ca')
  })

  it('молчащий сервер обрывается по таймауту', async () => {
    const { requestFn } = fakeRequest(null)
    const error = await createHttpsTransport(requestFn)({
      url: GIGACHAT_COMPLETIONS_URL,
      headers: {},
      body: '{}',
      timeoutMs: 20,
      ca: null,
    }).catch((caught) => caught)
    expect(llmFailureKind(error)).toBe('timeout')
  })
})
