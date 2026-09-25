/**
 * Content-Security-Policy страниц (решение 112).
 *
 * Политика собирается на каждый запрос страницы в middleware: скриптам
 * разрешено исполняться только с одноразовым nonce. Next находит его
 * в заголовке запроса `Content-Security-Policy` и сам ставит на свои
 * скрипты; встроенные скрипты корневого макета берут его из `x-nonce`.
 * Внедрённый в страницу `<script>` nonce не знает — браузер его не исполнит.
 *
 * Модуль выполняется в edge-среде middleware: только веб-API, без node:crypto.
 */

/** Заголовок запроса, в котором middleware передаёт nonce серверным компонентам. */
export const NONCE_HEADER = 'x-nonce'

/** 16 случайных байт в base64 — 128 бит, столько рекомендует спецификация CSP. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export interface CspOptions {
  nonce: string
  /**
   * Режим разработки: `next dev` исполняет модули через eval (быстрое
   * обновление) — без 'unsafe-eval' страница не оживёт. В боевой сборке eval нет.
   */
  dev: boolean
  /**
   * Страница открыта по HTTPS. Только тогда просим браузер поднимать
   * http-адреса до https: на стенде без домена (Caddy на :80) и на запасном
   * ноутбуке (http://localhost:3100) это сломало бы загрузку всех файлов.
   */
  https: boolean
}

export function buildContentSecurityPolicy({ nonce, dev, https }: CspOptions): string {
  const directives: string[] = [
    "default-src 'self'",
    // 'strict-dynamic': скрипт с nonce может подгрузить следующие — так Next
    // догружает куски приложения. Адреса-источники при этом браузер не смотрит:
    // исполнится только то, что пришло по цепочке от скрипта с nonce.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Встроенные стили оставлены: React пишет style="…" (позиции графиков,
    // ширины полосок, переменные цвета), а next/font и Next кладут <style>.
    // Выполнить код через стиль нельзя; остаётся только подмена вида страницы.
    "style-src 'self' 'unsafe-inline'",
    // data: — SVG-значки в CSS, blob: — снимки холстов.
    "img-src 'self' data: blob:",
    // next/font кладёт Inter в файлы сборки: запросов к чужим серверам нет.
    "font-src 'self'",
    "connect-src 'self'",
    // 3D-сцена входа и проверка «не робот» — в фоновых потоках из файлов сборки.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
  if (!dev && https) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}
