import { cookies } from 'next/headers'
import { prisma } from '@/shared/db/prisma'
import { containsNul } from '@/shared/db/storable'
import { AppError, unauthorized } from '@/shared/http/errors'
import type { UserRole } from '@/shared/contracts/enums'
import { auth } from './auth'
import { DEMO_USER_COOKIE, isDemoAuthEnabled } from './demo-mode'

export { DEMO_USER_COOKIE, isDemoAuthEnabled }

export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  /** Заполнен только у UNIVERSITY_REP: ограничивает видимость своим вузом. */
  universityId: string | null
}

/**
 * Порядок выбора пользователя по умолчанию в демо-режиме.
 * Менеджер первым: система создана для него, и демонстрация должна начинаться
 * с прав обычного сотрудника, а не администратора.
 */
const DEFAULT_ROLE_ORDER: UserRole[] = ['MANAGER', 'ADMIN', 'ANALYST', 'VIEWER']

const USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  universityId: true,
} as const

async function readUserIdFromCookie(): Promise<string | null> {
  try {
    const store = await cookies()
    return store.get(DEMO_USER_COOKIE)?.value ?? null
  } catch {
    // Вне контекста запроса (скрипты, тесты) cookie недоступны — это не ошибка.
    return null
  }
}

/**
 * Текст ошибки для журнала — без токенов.
 *
 * Сообщения библиотек разбора JWT обычно токен не повторяют, но полагаться на это
 * нельзя: токен сессии в журнале — это вход под чужим именем для любого, кто журнал
 * читает. Всё, что похоже на JWT, вырезается, длина ограничена.
 */
export function describeAuthError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return text.replace(/eyJ[\w-]*(?:\.[\w-]*)*/g, '[токен скрыт]').slice(0, 300)
}

/** Пользователь из настоящей сессии NextAuth. */
async function fromSession(): Promise<CurrentUser | null> {
  // Тип выводится из вызова без аргументов: у `auth` несколько перегрузок,
  // и явная аннотация схлопнула бы их в объединение с типом middleware.
  let userId: string | null = null
  try {
    const session = await auth()
    userId = session?.user?.id ?? null
  } catch (error) {
    // Отсутствие сессии — это `null` от auth(), а не исключение. Исключение — сбой
    // проверки входа, и молча считать его «сессии нет» нельзя: в демо-режиме запрос
    // ушёл бы к демо-пользователю и получил права менеджера, хотя за ним могла
    // стоять чья-то настоящая сессия. Поэтому — в журнал и отказ, без запасного пути.
    console.error('[AUTH] не удалось прочитать сессию:', describeAuthError(error))
    throw new AppError('INTERNAL', 'Не удалось проверить вход. Обновите страницу или войдите заново')
  }

  if (!userId) return null

  // Роль перечитывается из базы: она могла измениться после выдачи токена,
  // а права важнее удобства.
  return prisma.user.findFirst({ where: { id: userId, isActive: true }, select: USER_FIELDS })
}

async function fromDemoCookie(): Promise<CurrentUser | null> {
  const cookieUserId = await readUserIdFromCookie()
  // Cookie задаёт клиент: значение с символом кода 0 — не id, а запрос к базе с ним падает.
  if (!cookieUserId || containsNul(cookieUserId)) return null
  return prisma.user.findFirst({
    where: { id: cookieUserId, isActive: true },
    select: USER_FIELDS,
  })
}

async function demoFallbackUser(): Promise<CurrentUser | null> {
  // Приоритет ролей задаётся списком, а не полем сортировки: в SQL порядок элементов
  // IN не сохраняется, поэтому кандидаты выбираются запросом, а упорядочиваются в коде.
  const candidates = await prisma.user.findMany({
    where: { isActive: true, role: { in: DEFAULT_ROLE_ORDER } },
    orderBy: { createdAt: 'asc' },
    select: USER_FIELDS,
  })

  return (
    candidates
      .slice()
      .sort((a, b) => DEFAULT_ROLE_ORDER.indexOf(a.role) - DEFAULT_ROLE_ORDER.indexOf(b.role))[0] ??
    null
  )
}

/**
 * Единственная точка получения текущего пользователя (решение 9 в CLAUDE.md).
 *
 * Порядок: настоящая сессия NextAuth → демо-cookie → демо-пользователь по умолчанию.
 * Два последних шага работают только в демо-режиме.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const fromRealSession = await fromSession()
  if (fromRealSession) return fromRealSession

  if (!isDemoAuthEnabled()) {
    throw unauthorized('Требуется вход в систему')
  }

  const byCookie = await fromDemoCookie()
  if (byCookie) return byCookie

  const fallback = await demoFallbackUser()
  if (!fallback) {
    throw unauthorized('Пользователь не определён. Запустите npm run db:seed')
  }
  return fallback
}
