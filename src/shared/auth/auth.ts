import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { prisma } from '@/shared/db/prisma'
import { containsNul } from '@/shared/db/storable'
import type { UserRole } from '@/shared/contracts/enums'
import { writeAudit } from '@/shared/audit/audit'
import { checkLogin, clientAddress, needsCaptcha, throttledAttempt } from './throttle'
import { parseSolution, verifySolution } from './captcha'
import { loginAuditEntries, type LoginOutcome } from './login-audit'

/**
 * Аутентификация на NextAuth.js с сессиями на JWT (как обещано в концепции).
 *
 * Пароли хранятся хешами bcrypt. Ни один модуль не обращается сюда напрямую:
 * весь доступ идёт через `getCurrentUser()` — заменить реализацию можно, не трогая
 * бизнес-логику (решение 9).
 */

/**
 * Вход временно закрыт: исчерпаны попытки.
 *
 * Отдельный код, а не общий «неверные данные»: иначе человек 15 минут вводит
 * правильный пароль, получает отказ и решает, что забыл его. Экран входа
 * получает `code=too_many_attempts` и говорит прямо, сколько ждать.
 *
 * Существование учётной записи код не выдаёт: счётчик ведётся по введённому
 * адресу, есть он в базе или нет, и несуществующий закрывается точно так же.
 * А тот, кто исчерпал попытки, и так знает, что их исчерпал.
 */
class LoginThrottledError extends CredentialsSignin {
  code = 'too_many_attempts'
}

/**
 * Нужна проверка «не робот» (captcha.ts, решение 100): после нескольких неудач
 * вход ждёт решённую задачу. Пароль при этом не проверяется и неудача
 * не засчитывается — экран входа решает задачу и повторяет попытку сам.
 */
class CaptchaRequiredError extends CredentialsSignin {
  code = 'captcha_required'
}

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: resolveSecret(),
  /**
   * Сессия живёт восемь часов — рабочий день, а не тридцать дней по умолчанию:
   * забытый открытым ноутбук на показе или в аудитории не должен оставаться
   * входом в систему на месяц. Продлевается не чаще раза в час.
   */
  session: { strategy: 'jwt', maxAge: 8 * 3600, updateAge: 3600 },
  trustHost: true,
  /**
   * Своя страница входа.
   *
   * Встроенная страница NextAuth на английском и не знает ни о демо-доступе,
   * ни о блокировке после пяти неудач. Ошибки приходят на неё же параметрами
   * `error` и `code` — страница показывает их русским текстом.
   */
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      name: 'Электронная почта и пароль',
      credentials: {
        email: { label: 'Электронная почта', type: 'email' },
        password: { label: 'Пароль', type: 'password' },
        // Решение задачи «не робот» — только после нескольких неудач (captcha.ts).
        captcha: { type: 'hidden' },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''
        if (email === '' || password === '') return null

        // Перебор пароля ограничивается по паре «учётная запись + адрес клиента»,
        // по адресу и общим потолком учётной записи (throttle.ts). Проверка идёт
        // до запроса к базе и до сравнения хеша: заблокированная попытка не должна
        // стоить ни запроса, ни bcrypt. Неудача засчитывается сразу — иначе
        // одновременные попытки проходили проверку все разом (throttledAttempt).
        const source = { account: email.toLowerCase(), address: clientAddress(request.headers) }

        // Проверка «не робот» — до перебора: без решённой задачи пароль не сравнивается
        // и неудача не засчитывается. Закрытый вход проверку пропускает: человек
        // должен узнать, что ждать 15 минут, а не решать задачу впустую.
        // Всё синхронно, без `await`: решение помечается использованным тут же.
        if (
          !checkLogin(source).blocked &&
          needsCaptcha(source) &&
          !verifySolution(parseSolution(credentials?.captcha), resolveSecret())
        ) {
          throw new CaptchaRequiredError()
        }
        // Для журнала: чья учётная запись, если она существует. Почта в журнал не идёт.
        let knownUserId: string | null = null
        const attempt = await throttledAttempt(source, async () => {
          // Адреса с символом кода 0 в базе нет и быть не может, а запрос с ним падает —
          // и вход отвечал «ошибка конфигурации». Такой адрес — просто неизвестный.
          const user = containsNul(email)
            ? null
            : await prisma.user.findFirst({
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

          // Одинаковый ответ на «нет пользователя» и «неверный пароль»: по разнице
          // сообщений перебирались бы существующие адреса. Исчерпанные попытки —
          // отдельный код: он существования адреса не выдаёт.
          if (!user?.passwordHash) {
            // Сравнение с заведомо неверным хешем выравнивает время ответа.
            //
            // Без него ответ на несуществующий адрес приходил заметно быстрее:
            // bcrypt не выполнялся вовсе. По разнице во времени существование
            // учётной записи определяется так же надёжно, как по тексту ошибки,
            // который мы специально сделали одинаковым.
            await compare(password, TIMING_EQUALIZER_HASH)
            return null
          }

          knownUserId = user.id
          const matches = await compare(password, user.passwordHash)
          return matches ? user : null
        })

        if (attempt.blocked) throw new LoginThrottledError()
        const user = attempt.result

        const outcome: LoginOutcome = user
          ? { kind: 'success', userId: user.id, address: source.address }
          : { kind: 'failure', userId: knownUserId, address: source.address, triggered: attempt.triggered }
        for (const entry of loginAuditEntries(outcome)) await writeAudit(entry)

        if (!user) return null

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
