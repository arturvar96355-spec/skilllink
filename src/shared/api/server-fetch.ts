import { cookies } from 'next/headers'

/**
 * Запрос к собственному API из серверного компонента.
 *
 * Обычный `fetch` на сервере **не несёт cookie пользователя**: запрос уходит
 * от имени процесса, а не от имени того, кто открыл страницу. В демо-режиме это
 * молча подставляет пользователя по умолчанию, и страница показывает чужие данные —
 * представитель вуза увидел бы кабинет менеджера. В промышленном режиме тот же
 * запрос вернёт 401, и страница окажется пустой.
 *
 * Ошибка не заметна при разработке: под менеджером всё выглядит правильно.
 * Поэтому здесь и есть эта обёртка — чтобы правильный способ был короче неправильного.
 *
 * ```tsx
 * import { apiFetch } from '@/shared/api/server-fetch'
 *
 * export default async function Page() {
 *   const response = await apiFetch('/api/universities?pageSize=20')
 *   const body = await response.json()
 *   return <div>{body.data.length}</div>
 * }
 * ```
 *
 * В клиентских компонентах обёртка не нужна: браузер отправляет cookie сам.
 */

/**
 * Куда идёт запрос.
 *
 * Адрес НИКОГДА не берётся из заголовков запроса. `Host` и тем более
 * `X-Forwarded-Host` задаёт тот, кто прислал запрос: подделав заголовок,
 * он заставил бы сервер отправить cookie пользователя на чужой адрес.
 * Это не теория — так и было в первой версии обёртки.
 *
 * Поэтому либо явно заданный `APP_BASE_URL`, либо обращение к самому себе
 * по петлевому адресу. Второе увести никуда нельзя.
 */
function resolveBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const port = process.env.PORT?.trim() || '3000'
  return `http://127.0.0.1:${port}`
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.toString()

  return fetch(`${resolveBaseUrl()}${path}`, {
    ...init,
    // Данные страницы не кешируются: иначе после действия пользователь увидит
    // прежнее состояние и решит, что оно не сохранилось.
    cache: init.cache ?? 'no-store',
    headers: {
      ...init.headers,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  })
}
