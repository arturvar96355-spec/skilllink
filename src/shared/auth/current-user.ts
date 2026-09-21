import { cookies } from 'next/headers'
import { prisma } from '@/shared/db/prisma'
import { unauthorized } from '@/shared/http/errors'
import type { UserRole } from '@/shared/contracts/enums'

/** Имя cookie, которой демо-стенд выбирает текущего пользователя (P0). */
export const DEMO_USER_COOKIE = 'skilllink_user'

export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  /** Заполнен только у UNIVERSITY_REP: ограничивает видимость своим вузом. */
  universityId: string | null
}

/** Порядок выбора пользователя по умолчанию, когда cookie не задана. */
const DEFAULT_ROLE_ORDER: UserRole[] = ['MANAGER', 'ADMIN', 'ANALYST', 'VIEWER']

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
 * Единственная точка получения текущего пользователя (решение 9 в CLAUDE.md).
 *
 * P0: mock-авторизация. Пользователь берётся из cookie `skilllink_user`,
 * иначе — первый активный сотрудник по приоритету ролей.
 * P1: здесь появится NextAuth.js с bcrypt; вызывающий код не меняется.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const cookieUserId = await readUserIdFromCookie()

  if (cookieUserId) {
    const byCookie = await prisma.user.findFirst({
      where: { id: cookieUserId, isActive: true },
      select: { id: true, email: true, fullName: true, role: true, universityId: true },
    })
    if (byCookie) return byCookie
  }

  const fallback = await prisma.user.findFirst({
    where: { isActive: true, role: { in: DEFAULT_ROLE_ORDER } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, fullName: true, role: true, universityId: true },
  })

  if (!fallback) {
    throw unauthorized('Пользователь не определён. Запустите npm run db:seed')
  }
  return fallback
}
