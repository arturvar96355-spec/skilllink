import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from '@/shared/db/prisma'
import type { UserRole } from '@/shared/contracts/enums'

/**
 * Аутентификация на NextAuth.js с сессиями на JWT (как обещано в концепции).
 *
 * Пароли хранятся хешами bcrypt. Ни один модуль не обращается сюда напрямую:
 * весь доступ идёт через `getCurrentUser()` — заменить реализацию можно, не трогая
 * бизнес-логику (решение 9).
 */

/** Данные, которые кладутся в токен: их хватает для проверки прав без запроса к базе. */
export interface SessionUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  universityId: string | null
}

declare module 'next-auth' {
  interface Session {
    user: SessionUser & { name?: string | null; email?: string | null }
  }
}

/**
 * Секрет обязателен: без него JWT не подписывается.
 * В разработке подставляется заглушка, чтобы стенд поднимался из коробки,
 * но в продакшене отсутствие секрета — это падение при старте, а не тихая работа.
 */
function resolveSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.trim().length > 0) return secret

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Не задана переменная окружения AUTH_SECRET')
  }
  return 'skilllink-dev-secret-not-for-production'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: resolveSecret(),
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Электронная почта и пароль',
      credentials: {
        email: { label: 'Электронная почта', type: 'email' },
        password: { label: 'Пароль', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''
        if (email === '' || password === '') return null

        const user = await prisma.user.findFirst({
          where: { email: email.toLowerCase(), isActive: true },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            universityId: true,
            passwordHash: true,
          },
        })

        // Одинаковый ответ на «нет пользователя» и «неверный пароль»:
        // по разнице сообщений можно перебирать существующие адреса.
        if (!user?.passwordHash) return null

        const matches = await compare(password, user.passwordHash)
        if (!matches) return null

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          fullName: user.fullName,
          role: user.role,
          universityId: user.universityId,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const authorized = user as unknown as SessionUser
        token.id = authorized.id
        token.fullName = authorized.fullName
        token.role = authorized.role
        token.universityId = authorized.universityId
      }
      return token
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: String(token.id ?? ''),
        email: String(token.email ?? ''),
        fullName: String(token.fullName ?? ''),
        role: token.role as UserRole,
        universityId: (token.universityId as string | null) ?? null,
      }
      return session
    },
  },
})
