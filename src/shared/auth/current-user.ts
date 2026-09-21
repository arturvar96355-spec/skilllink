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

/**
 * Порядок выбора пользователя по умолчанию, когда cookie не задана.
 * Менеджер первым: система создана для него, и демонстрация должна начинаться
 * с прав обычного сотрудника, а не администратора.
 */
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

  // Приоритет ролей задаётся списком, а не полем сортировки: в SQL порядок элементов
  // IN не сохраняется, поэтому кандидаты выбираются запросом, а упорядочиваются в коде.
  const candidates = await prisma.user.findMany({
    where: { isActive: true, role: { in: DEFAULT_ROLE_ORDER } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, fullName: true, role: true, universityId: true },
  })

  const fallback = candidates
    .slice()
    .sort((a, b) => DEFAULT_ROLE_ORDER.indexOf(a.role) - DEFAULT_ROLE_ORDER.indexOf(b.role))[0]

  if (!fallback) {
    throw unauthorized('Пользователь не определён. Запустите npm run db:seed')
  }
  return fallback
}
