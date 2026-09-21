import type { NextConfig } from 'next'

/**
 * Защитные заголовки ответа.
 *
 * Дешёвая часть защиты, которую нельзя добавить «потом»: браузер полагается на них
 * при каждом ответе, и их отсутствие не видно ни в одном тесте функциональности.
 *
 * Content-Security-Policy здесь намеренно нет: Next вставляет встроенные скрипты,
 * и строгая политика без проброса nonce сломает приложение молча — на проде
 * в самый неудачный момент. Это отдельная задача, описана в SECURITY_LIMITATIONS.md.
 */
const SECURITY_HEADERS = [
  // Не угадывать тип содержимого: загруженный текст не должен исполниться как скрипт.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Приложение не предназначено для встраивания в чужие страницы (защита от кликджекинга).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Адреса внутренних страниц не утекают на сторонние сайты в заголовке Referer:
  // в них бывают идентификаторы вузов и связок.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Возможности браузера, которые системе не нужны, отключены явно.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Межсайтовые окна и документы не получают ссылку на наше окно.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

const nextConfig: NextConfig = {
  // standalone-сборка кладёт в .next/standalone сервер со всеми нужными зависимостями:
  // образу не нужен весь node_modules, и он получается в разы меньше.
  output: 'standalone',
  // Prisma и драйвер Postgres не бандлятся: работают как обычные node-модули на сервере.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
