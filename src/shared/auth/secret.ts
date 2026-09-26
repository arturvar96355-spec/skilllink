/**
 * Секрет подписи сессий (`AUTH_SECRET`) — отдельно от `auth.ts`.
 *
 * `auth.ts` статически импортирует NextAuth и Prisma (`@/shared/db/prisma` → `pg`,
 * который нужен для SSL-сертификатов и требует `fs`/`path`/`stream`). Node-модули
 * `pg` не резолвятся при сборке edge-варианта: Next компилирует `instrumentation.ts`
 * и для Node.js, и для edge-времени выполнения middleware, и `import()`, даже
 * динамический и защищённый проверкой `NEXT_RUNTIME`, всё равно резолвится
 * бандлером на этапе построения графа зависимостей — до отбрасывания мёртвого
 * кода. Поэтому код, который `instrumentation.ts` подключает динамически (решение
 * 142, запуск приёма Telegram при старте), не должен доставать секрет через
 * `@/shared/auth/auth`: он через модуль-посредник ничего не знал бы про NextAuth,
 * а этот файл — ничего не знает про Prisma.
 *
 * `auth.ts` переиспользует эту же функцию (`export { resolveSecret } from
 * './secret'`) — реализация одна, просто в модуле без побочных тяжёлых импортов.
 */

const DEV_SECRET = 'skilllink-dev-secret-not-for-production'

/**
 * В продакшене отсутствие секрета — падение при старте, а не тихая работа с
 * известным всем значением. Но на этапе сборки токены не выпускаются, и требовать
 * там боевой секрет нельзя: иначе `next build` не пройдёт ни в CI, ни при сборке
 * образа, куда секреты попадают только на запуске.
 */
export function resolveSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.trim().length > 0) return secret

  // Next выставляет эту переменную только во время `next build`.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
  if (isBuildPhase) return DEV_SECRET

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Не задана переменная окружения AUTH_SECRET. Сгенерируйте её командой:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
        'Через node, а не openssl: на Windows openssl обычно не установлен.',
    )
  }
  return DEV_SECRET
}
