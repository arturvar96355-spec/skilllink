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
import { renewedSessionVersion, tokenSessionVersion } from './session-version'
import { countSafely } from '@/shared/metrics/app-metrics'
import { alertAdminLogin, alertLoginBlocked, noteCaptchaRequired } from '@/shared/ops/security-alerts'
import { resolveSecret } from './secret'
import { attemptExpertQuickLogin, isExpertQuickLoginEnabled } from './expert-quick-login'

/**
 * Аутентификация на NextAuth.js с сессиями на JWT (как обещано в концепции).
 *
 * Пароли хранятся хешами bcrypt. Ни один модуль не обращается сюда напрямую:
 * весь доступ идёт через `getCurrentUser()` — заменить реализацию можно, не трогая
 * бизнес-логику.
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
  /**
   * Версия сессий пользователя на момент входа (решение 109). `getCurrentUser()`
   * сверяет её с базой на каждом запросе: не совпала — сессия отозвана.
   */
  sessionVersion: number
}

declare module 'next-auth' {
  interface Session {
    user: SessionUser & { name?: string | null; email?: string | null }
  }
}

/**
 * Хеш заведомо недостижимого пароля — только чтобы занять то же время,
 * что занимает настоящая проверка. Значением не является секретом.
 */
const TIMING_EQUALIZER_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8e.VhYQ3o8KJ1p7hSJ3G0JhOqQZ1qi'

/**
 * Секрет подписи JWT — реализация в `./secret.ts` (модуль без NextAuth и Prisma,
 * его безопасно подключать из `instrumentation.ts`, решение 142). Реэкспорт —
 * чтобы весь остальной код по-прежнему брал секрет отсюда, как раньше.
 */
export { resolveSecret }

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
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
        // одновременные попытки прошли бы проверку все разом (throttledAttempt).
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
          countSafely((metrics) => metrics.captchaRequired.inc())
          // Массовое включение проверки — повод сообщить владельцу (решение 118).
          noteCaptchaRequired()
          throw new CaptchaRequiredError()
        }
        // Для журнала: чья учётная запись, если она существует. Почта в журнал не идёт.
        let knownUserId: string | null = null
        const loginAt = new Date()
        const attempt = await throttledAttempt(source, async () => {
          // Адреса с символом кода 0 в базе нет и быть не может, а запрос с ним падает —
          // и вход ответил бы «ошибка конфигурации». Такой адрес — просто неизвестный.
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
                  sessionVersion: true,
                },
              })

          // Одинаковый ответ на «нет пользователя» и «неверный пароль»: по разнице
          // сообщений перебирались бы существующие адреса. Исчерпанные попытки —
          // отдельный код: он существования адреса не выдаёт.
          if (!user?.passwordHash) {
            // Сравнение с заведомо неверным хешем выравнивает время ответа.
            //
            // Без него ответ на несуществующий адрес приходит заметно быстрее:
            // bcrypt не выполняется вовсе. По разнице во времени существование
            // учётной записи определяется так же надёжно, как по тексту ошибки,
            // который мы специально сделали одинаковым.
            await compare(password, TIMING_EQUALIZER_HASH)
            return null
          }

          knownUserId = user.id
          const matches = await compare(password, user.passwordHash)
          return matches ? user : null
        })

        if (attempt.blocked) {
          countSafely((metrics) => metrics.loginFailures.inc({ reason: 'throttled' }))
          throw new LoginThrottledError()
        }
        const user = attempt.result
        // Метрика — только число (решение 137): кто и откуда, пишет журнал действий.
        if (!user) countSafely((metrics) => metrics.loginFailures.inc({ reason: 'credentials' }))

        const outcome: LoginOutcome = user
          ? { kind: 'success', userId: user.id, address: source.address }
          : { kind: 'failure', userId: knownUserId, address: source.address, triggered: attempt.triggered }
        for (const entry of loginAuditEntries(outcome)) await writeAudit(entry)

        // Оповещения владельцу (решение 118): в фоне, вход их не ждёт.
        if (!user) alertLoginBlocked(source.account, source.address, attempt.triggered)
        else if (user.role === 'ADMIN') alertAdminLogin(user.id, source.address, loginAt)

        if (!user) return null

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          fullName: user.fullName,
          role: user.role,
          universityId: user.universityId,
          sessionVersion: user.sessionVersion,
        }
      },
    }),
    /**
     * Быстрый вход экспертов хакатона (решение 176): кнопки на экране входа,
     * без пароля, только в учётные записи с `is_reviewer = true` — проверка
     * идёт в базе на каждый клик (`attemptExpertQuickLogin`,
     * `shared/auth/expert-quick-login.ts`), список кнопок в браузере ничего
     * не решает. Провайдер регистрируется, только пока включена переменная
     * `EXPERT_QUICK_LOGIN`: выключено — его нет вовсе, как если бы кнопок
     * никогда не было (маршрут `/api/auth/{signin,callback}/expert` при этом
     * отвечает 404 — `route.ts` рядом с `[...nextauth]`).
     */
    ...(isExpertQuickLoginEnabled()
      ? [
          Credentials({
            id: 'expert',
            name: 'Быстрый вход эксперта',
            credentials: {
              // Ключ кнопки (`manager` | `admin` | `rep`), не почта и не пароль.
              account: { type: 'hidden' },
            },
            async authorize(credentials, request) {
              const key = typeof credentials?.account === 'string' ? credentials.account : ''
              const result = await attemptExpertQuickLogin(key, clientAddress(request.headers))

              if (result.outcome === 'blocked') throw new LoginThrottledError()
              if (result.outcome === 'denied') return null

              const { user } = result
              return {
                id: user.id,
                email: user.email,
                name: user.fullName,
                fullName: user.fullName,
                role: user.role,
                universityId: user.universityId,
                sessionVersion: user.sessionVersion,
              }
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        const authorized = user as unknown as SessionUser
        token.id = authorized.id
        token.fullName = authorized.fullName
        token.role = authorized.role
        token.universityId = authorized.universityId
        token.sessionVersion = authorized.sessionVersion
      }
      // Обновление сессии вызывает и сервер (продление после смены своего пароля),
      // и клиент (`POST /api/auth/session` с любыми данными). Версия меняется только
      // по подписанному сервером разрешению — иначе украденная cookie сама
      // переоформила бы себя на новую версию (session-version.ts).
      if (trigger === 'update') {
        const renewed = renewedSessionVersion(token, session, resolveSecret())
        if (renewed !== null) token.sessionVersion = renewed
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
        // Токен без версии выдан до её появления — версия 0 (session-version.ts).
        sessionVersion: tokenSessionVersion(token.sessionVersion),
      }
      return session
    },
  },
})
