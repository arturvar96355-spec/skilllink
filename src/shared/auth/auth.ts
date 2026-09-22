import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from '@/shared/db/prisma'
import type { UserRole } from '@/shared/contracts/enums'
import { checkLogin, recordFailure, recordSuccess } from './throttle'

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

const DEV_SECRET = 'skilllink-dev-secret-not-for-production'

/**
 * Хеш заведомо недостижимого пароля — только чтобы занять то же время,
 * что занимает настоящая проверка. Значением не является секретом.
 */
const TIMING_EQUALIZER_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8e.VhYQ3o8KJ1p7hSJ3G0JhOqQZ1qi'

/**
 * Секрет подписи JWT.
 *
 * В продакшене его отсутствие — падение при старте, а не тихая работа с известным
 * всем значением. Но на этапе сборки токены не выпускаются, и требовать там боевой
 * секрет нельзя: иначе `next build` не пройдёт ни в CI, ни при сборке образа, куда
 * секреты попадают только на запуске.
 */
function resolveSecret(): string {
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: resolveSecret(),
  session: { strategy: 'jwt' },
  trustHost: true,
  // Своей страницы входа нет — работает встроенная страница NextAuth (/api/auth/signin).
  // Когда фронт сделает собственную, сюда возвращается `pages: { signIn: '/login' }`:
  // до тех пор указывать несуществующий путь нельзя, иначе перенаправление ведёт на 404.
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

        // Перебор пароля ограничивается по учётной записи. Проверка идёт до запроса
        // к базе и до сравнения хеша: заблокированная попытка не должна стоить
        // ни запроса, ни bcrypt.
        const accountKey = email.toLowerCase()
        if (checkLogin(accountKey).blocked) return null

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

        // Одинаковый ответ на «нет пользователя», «неверный пароль» и «попытки
        // исчерпаны»: по разнице сообщений перебираются существующие адреса
        // и определяется, какие из них уже заблокированы.
        if (!user?.passwordHash) {
          // Сравнение с заведомо неверным хешем выравнивает время ответа.
          //
          // Без него ответ на несуществующий адрес приходил заметно быстрее:
          // bcrypt не выполнялся вовсе. По разнице во времени существование
          // учётной записи определяется так же надёжно, как по тексту ошибки,
          // который мы специально сделали одинаковым.
          await compare(password, TIMING_EQUALIZER_HASH)
          recordFailure(accountKey)
          return null
        }

        const matches = await compare(password, user.passwordHash)
        if (!matches) {
          recordFailure(accountKey)
          return null
        }

        recordSuccess(accountKey)

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
