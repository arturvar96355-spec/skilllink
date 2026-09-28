'use client'

import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { REAUTH_PARAM } from '@/shared/auth/reauth'
import { ARRIVAL_KEY } from '@/ui/layout/arrival'
import { WARP_NAVIGATE_MS } from './Constellation'
import { TiltCard } from './Depth'
import { safeReturnPath } from '@/shared/auth/return-path'
import { EXPERT_QUICK_LOGIN_ROLES, LOGIN_CAPTCHA, LOGIN_THROTTLE } from '@/shared/config/auth.config'
import { Button, Icon, Input, OPEN_SOURCE_REPO_URL, ROUTES } from '@/ui'
import { passCaptcha } from './captcha-solver'
import styles from './login.module.css'

/**
 * Форма входа и (при включённом `EXPERT_QUICK_LOGIN`, решение 176) блок
 * быстрого входа экспертов хакатона. Вынесено из `page.tsx`, потому что сама
 * страница — серверный компонент: она читает переменную окружения на сервере
 * (`isExpertQuickLoginEnabled()`) и решает, показывать ли этот блок вообще,
 * а форма и её ошибки — интерактивная часть, ей нужны хуки.
 *
 * Регистрации здесь нет намеренно: учётные записи заводит администратор,
 * самостоятельная регистрация в систему не заложена. Показывать вкладку,
 * за которой ничего нет, дизайн-система прямо запрещает.
 */

const BLOCK_MINUTES = Math.round(LOGIN_THROTTLE.blockMs / 60_000)

/** Сообщения об отказе входа. Текст объясняет, что делать, а не только называет ошибку. */
function errorMessage(error: string | null, code: string | null): string | null {
  if (!error && !code) return null
  if (code === 'captcha_required') {
    return 'Проверка «не робот» не прошла. Нажмите «Войти» ещё раз.'
  }
  if (code === 'too_many_attempts') {
    return `Слишком много неудачных попыток. Вход в эту учётную запись закрыт на ${BLOCK_MINUTES} минут — подождите и попробуйте снова.`
  }
  if (error === 'CredentialsSignin' || code === 'credentials') {
    return 'Неверная почта или пароль.'
  }
  return 'Войти не удалось. Попробуйте ещё раз.'
}

/** Отказ быстрого входа эксперта: тот же код блокировки, что у обычного входа, иначе — общий текст. */
function quickLoginErrorMessage(code: string | null): string {
  if (code === 'too_many_attempts') {
    return `Слишком много попыток. Вход в эту учётную запись закрыт на ${BLOCK_MINUTES} минут — подождите и попробуйте снова.`
  }
  return 'Быстрый вход недоступен для этой учётной записи.'
}

/**
 * Отказ единого входа через Keycloak (решение 188). `AccessDenied` — signIn()
 * в `auth.ts` не нашёл активную учётную запись SkillLink с этой почтой: сама
 * почта не называется — по тем же причинам, что и у обычного входа.
 */
function ssoErrorMessage(error: string | null): string | null {
  if (!error) return null
  if (error === 'AccessDenied') {
    return 'Эта учётная запись Keycloak не сопоставлена с пользователем SkillLink, либо доступ заблокирован. ' +
      'Обратитесь к администратору или войдите электронной почтой и паролем.'
  }
  return 'Единый вход не удался. Попробуйте ещё раз или войдите электронной почтой и паролем.'
}

export interface LoginFormProps {
  /** Показывать ли блок «Вход для экспертов хакатона» (решение 176). */
  expertQuickLoginEnabled: boolean
  /** Показывать ли кнопку «Для сотрудников РТК (единый вход)» — вход через Keycloak (решение 188, переменные `KEYCLOAK_*`). */
  keycloakEnabled: boolean
}

function LoginFormInner({ expertQuickLoginEnabled, keycloakEnabled }: LoginFormProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPending, setIsPending] = useState(false)
  /** Ключ кнопки быстрого входа, которая сейчас ждёт ответ сервера — не более одной сразу. */
  const [quickPending, setQuickPending] = useState<string | null>(null)
  /** Единый вход через Keycloak (решение 188) ждёт перехода на экран Keycloak. */
  const [ssoPending, setSsoPending] = useState(false)
  /** Вход удался: панель уходит с экрана, и только потом открывается приложение. */
  const [isLeaving, setIsLeaving] = useState(false)
  const initialError = params.get('error')
  /**
   * Была ли уже неудачная попытка входа паролем: только тогда под ошибкой
   * появляется предупреждение о проверке «не робот» и блокировке. Раньше этот
   * абзац стоял на панели всегда — и из-за него панель не помещалась на экран
   * ноутбука без прокрутки. Сами пороги считает сервер, здесь — только текст.
   */
  const [hadFailure, setHadFailure] = useState(
    initialError === 'CredentialsSignin' || params.get('code') !== null,
  )
  const [message, setMessage] = useState<string | null>(
    // AccessDenied приходит только от signIn() провайдера keycloak (auth.ts) —
    // Credentials и expert отказывают своим кодом через CredentialsSignin.
    initialError === 'AccessDenied' ? ssoErrorMessage(initialError) : errorMessage(initialError, params.get('code')),
  )
  /**
   * Проверка «не робот» (решение 100): сервер попросил её после нескольких неудач.
   * Браузер решает задачу сам, человек видит только строку состояния.
   */
  const [captcha, setCaptcha] = useState<'off' | 'solving' | 'passed'>('off')
  // Сюда привело приложение: сессия была, но сервер её больше не принимает —
  // например, демо-данные перезалиты и пользователи созданы заново.
  const isReauth = params.has(REAUTH_PARAM)

  const busy = isPending || isLeaving || quickPending !== null || ssoPending

  /**
   * Общий хвост удачного входа — паролем или кнопкой эксперта: одна и та же
   * анимация ухода панели и переход туда, куда человек шёл до входа.
   */
  function proceedAfterSignIn() {
    const destination = safeReturnPath(params.get('from'))
    // Главная собирается заранее, пока идёт анимация: переход потом почти мгновенный.
    router.prefetch(destination)
    setIsLeaving(true)
    // Экран входа превращается в приложение (07, раздел 18): форма гаснет,
    // панель раскрывается в холст, маршрут слева уходит вправо. Длительность
    // совпадает с анимацией в login.module.css; главная продолжает сцену
    // своим появлением. Дольше полусекунды человек не ждёт.
    document.body.dataset.authLeaving = 'true'
    // Приложение само допишет сцену: меню проявится от левого края (AppShell).
    try {
      window.sessionStorage.setItem(ARRIVAL_KEY, '1')
    } catch {
      // Без хранилища — просто без продолжения сцены.
    }
    // С 3D-прыжком (Constellation) страница меняется на середине воронки: сайт
    // под звёздами скрыт, пока они его не соберут (решение 76), а звёзды рисует
    // фоновый поток — сборка главной их не останавливает. Без прыжка — как раньше.
    const warp = document.body.dataset.warp === 'ready'
    window.setTimeout(() => {
      router.replace(destination)
      router.refresh()
      delete document.body.dataset.authLeaving
    }, warp ? WARP_NAVIGATE_MS : 420)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsPending(true)
    setMessage(null)

    // redirect: false — ошибку показываем на этой же странице, а не уводим
    // пользователя на отдельный экран ошибки и обратно.
    //
    // signIn не только возвращает ошибку, но и бросает её — при обрыве сети
    // или не-JSON ответе прокси. Без перехвата кнопка оставалась в ожидании
    // навсегда, без единого слова.
    //
    // После нескольких неудач сервер отвечает `captcha_required`, не проверяя пароль:
    // тогда задача решается и попытка повторяется сама — второй раз «Войти»
    // нажимать не нужно. Дальше задача решается заранее, до каждой попытки.
    const solveCaptcha = async (): Promise<string> => {
      setCaptcha('solving')
      const solution = await passCaptcha()
      setCaptcha('passed')
      return solution
    }
    const attempt = (solution: string | null) =>
      signIn('credentials', { email, password, ...(solution ? { captcha: solution } : {}), redirect: false })

    let result: Awaited<ReturnType<typeof signIn>> | null
    try {
      const solution = captcha === 'off' ? null : await solveCaptcha()
      result = await attempt(solution)
      if (result?.code === 'captcha_required' && solution === null) {
        result = await attempt(await solveCaptcha())
      }
    } catch {
      setIsPending(false)
      setMessage('Сервер не ответил. Проверьте подключение и попробуйте ещё раз.')
      return
    }
    setIsPending(false)

    if (!result || result.error) {
      setHadFailure(true)
      setMessage(errorMessage(result?.error ?? 'CredentialsSignin', result?.code ?? null))
      return
    }

    proceedAfterSignIn()
  }

  /**
   * Кнопка быстрого входа эксперта (решение 176): без пароля, без капчи —
   * сервер сверяет ключ кнопки с базой (`is_reviewer = true`) на каждый клик.
   * Тот же провайдер NextAuth, что и обычный вход, только по имени `expert`
   * и с полем `account` вместо почты и пароля.
   */
  async function onQuickLogin(key: string) {
    setMessage(null)
    setQuickPending(key)

    let result: Awaited<ReturnType<typeof signIn>> | null
    try {
      result = await signIn('expert', { account: key, redirect: false })
    } catch {
      setQuickPending(null)
      setMessage('Сервер не ответил. Проверьте подключение и попробуйте ещё раз.')
      return
    }
    setQuickPending(null)

    if (!result || result.error) {
      setMessage(quickLoginErrorMessage(result?.code ?? null))
      return
    }

    proceedAfterSignIn()
  }

  /**
   * Единый вход через Keycloak (решение 188): полноценный переход на экран
   * Keycloak, а не запрос без перезагрузки, как у Credentials, — OpenID
   * Connect по-другому не работает. `signIn()` сам сделает `window.location`
   * на адрес Keycloak; отметка сцены прихода выставляется заранее, потому что
   * после возврата (`/api/auth/callback/keycloak` → `destination`) это уже
   * новая загрузка страницы, и этот компонент её не увидит.
   */
  async function onKeycloakLogin() {
    setMessage(null)
    setSsoPending(true)
    const destination = safeReturnPath(params.get('from'))
    try {
      window.sessionStorage.setItem(ARRIVAL_KEY, '1')
    } catch {
      // Без хранилища — просто без продолжения сцены после возврата от Keycloak.
    }
    try {
      await signIn('keycloak', { callbackUrl: destination })
    } catch {
      setSsoPending(false)
      setMessage('Сервер не ответил. Проверьте подключение и попробуйте ещё раз.')
    }
  }

  return (
    <TiltCard resting={isLeaving}>
      <div className={[styles.panel, isLeaving ? styles.leaving : ''].filter(Boolean).join(' ')}>
        {/* Светящаяся линия, бегущая по кромке панели (решение 92). */}
        <span className={styles.edge} aria-hidden="true" />
        <div className={styles.panelHead}>
          <h1 className={styles.title}>Вход</h1>
          {/* Одна строка: пояснение про учётные записи — для программ чтения с экрана и в подсказке. */}
          <p className={styles.subtitle} title="Учётные записи заводит администратор системы">
            Рабочая почта и пароль
            <span className="visually-hidden">. Учётные записи заводит администратор системы.</span>
          </p>
        </div>

        {/*
          Вход для экспертов хакатона (решение 176) — первым, над Keycloak (решение 228):
          эксперт жюри не должен упираться в форму единого входа РТК, которой у него нет.
        */}
        {expertQuickLoginEnabled && (
          <div className={styles.expertLogin}>
            {/* Заголовок и пояснение — одной строкой; пояснение привязано к кнопкам для программ чтения. */}
            <div className={styles.expertLoginHead}>
              <p className={styles.expertLoginTitle}>Вход для экспертов хакатона</p>
              <p id="expert-login-scope" className={styles.expertLoginScope}>
                демо-доступ, только просмотр
              </p>
            </div>
            <div className={styles.expertLoginButtons}>
              {EXPERT_QUICK_LOGIN_ROLES.map((role) => (
                <Button
                  key={role.key}
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={quickPending === role.key}
                  disabled={busy && quickPending !== role.key}
                  aria-describedby="expert-login-scope"
                  onClick={() => onQuickLogin(role.key)}
                >
                  {role.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {keycloakEnabled && (
          <div className={styles.ssoLogin}>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              isLoading={ssoPending}
              disabled={busy && !ssoPending}
              onClick={onKeycloakLogin}
            >
              Для сотрудников РТК (единый вход)
            </Button>
            <p className={styles.ssoDivider}>или почтой и паролем</p>
          </div>
        )}

        <form className={styles.form} onSubmit={onSubmit}>
          <Input
            label="Электронная почта"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.ru"
            icon="mail"
            autoComplete="username"
            required
            autoFocus
          />
          <Input
            label="Пароль"
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            icon="lock"
            autoComplete="current-password"
            required
          />

          {captcha !== 'off' && (
            <p className={styles.notice} role="status">
              <Icon name={captcha === 'passed' ? 'check' : 'lock'} size={18} />
              {captcha === 'solving'
                ? 'Проверяем, что вход не автоматический…'
                : 'Проверка «не робот» пройдена — это защита от подбора пароля.'}
            </p>
          )}
          {isReauth && !message && (
            <p className={styles.notice} role="status">
              <Icon name="info" size={18} />
              Сессия устарела — войдите снова.
            </p>
          )}
          {message && (
            <p className={styles.error} role="alert">
              <Icon name="alert" size={18} />
              {message}
            </p>
          )}
          {/* Предупреждение о защите от подбора — только после первой неудачи, рядом с ошибкой. */}
          {hadFailure && (
            <p className={styles.note}>
              После {LOGIN_CAPTCHA.afterFailures} неудачных попыток вход проверяет, что он
              не автоматический, — браузер делает это сам за пару секунд. После{' '}
              {LOGIN_THROTTLE.maxFailures} подряд вход в учётную запись закрывается
              на {BLOCK_MINUTES} минут — это защита от подбора пароля.
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            size="lg"
            fullWidth
            isLoading={isPending || isLeaving}
            disabled={busy}
          >
            Войти
          </Button>
        </form>

        {!expertQuickLoginEnabled && (
          // Кнопок нет (переменная EXPERT_QUICK_LOGIN выключена) — учётные записи
          // экспертов по-прежнему есть (решение 147), вход в них — обычной формой выше.
          <p className={styles.note}>
            Экспертам хакатона: учётные записи — в описании решения на платформе конкурса.
          </p>
        )}


        {/*
          Подвал панели — одной строкой: политика и открытый код (решение владельца —
          ссылка на репозиторий заметна на стенде; полный адрес — в подсказке).
        */}
        <p className={styles.panelFoot}>
          {/* «Персональные данные» — как в подвале системы: с «Документацией» (решение 214)
              подвал панели остаётся одной строкой; полное название — в подсказке. */}
          <Link href={ROUTES.privacy} className={styles.privacyLink} title="Политика обработки персональных данных">
            Персональные данные
          </Link>
          <span className={styles.panelFootSep} aria-hidden="true" />
          {/* Документация открыта без входа (решение 214). */}
          <Link href={ROUTES.docs} className={styles.privacyLink}>
            Документация
          </Link>
          <span className={styles.panelFootSep} aria-hidden="true" />
          <a
            href={OPEN_SOURCE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.privacyLink}
            title="github.com/arturvar96355-spec/skilllink — откроется в новой вкладке"
          >
            Открытый код
          </a>
        </p>
      </div>
    </TiltCard>
  )
}

export function LoginForm(props: LoginFormProps) {
  // useSearchParams требует границы Suspense: без неё страница не пройдёт сборку.
  return (
    <Suspense fallback={null}>
      <LoginFormInner {...props} />
    </Suspense>
  )
}
