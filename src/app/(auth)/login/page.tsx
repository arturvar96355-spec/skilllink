'use client'

import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { REAUTH_PARAM } from '@/shared/auth/reauth'
import { safeReturnPath } from '@/shared/auth/return-path'
import { LOGIN_THROTTLE } from '@/shared/config/auth.config'
import { Button, Icon, Input, Logo } from '@/ui'
import styles from './login.module.css'

/**
 * Вход в систему.
 *
 * Регистрации здесь нет намеренно: учётные записи заводит администратор,
 * самостоятельная регистрация в систему не заложена. Показывать вкладку,
 * за которой ничего нет, дизайн-система прямо запрещает.
 */

const BLOCK_MINUTES = Math.round(LOGIN_THROTTLE.blockMs / 60_000)

/** Сообщения об отказе входа. Текст объясняет, что делать, а не только называет ошибку. */
function errorMessage(error: string | null, code: string | null): string | null {
  if (!error && !code) return null
  if (code === 'too_many_attempts') {
    return `Слишком много неудачных попыток. Вход в эту учётную запись закрыт на ${BLOCK_MINUTES} минут — подождите и попробуйте снова.`
  }
  if (error === 'CredentialsSignin' || code === 'credentials') {
    return 'Неверная почта или пароль.'
  }
  return 'Войти не удалось. Попробуйте ещё раз.'
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPending, setIsPending] = useState(false)
  /** Вход удался: панель уходит с экрана, и только потом открывается приложение. */
  const [isLeaving, setIsLeaving] = useState(false)
  const [message, setMessage] = useState<string | null>(
    errorMessage(params.get('error'), params.get('code')),
  )
  // Сюда привело приложение: сессия была, но сервер её больше не принимает —
  // например, демо-данные перезалиты и пользователи созданы заново.
  const isReauth = params.has(REAUTH_PARAM)

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
    let result: Awaited<ReturnType<typeof signIn>> | null
    try {
      result = await signIn('credentials', { email, password, redirect: false })
    } catch {
      setIsPending(false)
      setMessage('Сервер не ответил. Проверьте подключение и попробуйте ещё раз.')
      return
    }
    setIsPending(false)

    if (!result || result.error) {
      setMessage(errorMessage(result?.error ?? 'CredentialsSignin', result?.code ?? null))
      return
    }

    // Возвращаем туда, куда человек шёл до перенаправления на вход, —
    // но только в пределах сайта: `from` задаётся ссылкой.
    const destination = safeReturnPath(params.get('from'))
    setIsLeaving(true)
    // Длительность совпадает с анимацией ухода в login.module.css.
    window.setTimeout(() => {
      router.replace(destination)
      router.refresh()
    }, 300)
  }

  return (
    <div className={[styles.panel, isLeaving ? styles.leaving : ''].filter(Boolean).join(' ')}>
      <div className={styles.panelHead}>
        <h1 className={styles.title}>Вход</h1>
        <p className={styles.subtitle}>
          Рабочая почта и пароль. Учётные записи заводит администратор системы.
        </p>
      </div>

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

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          isLoading={isPending || isLeaving}
        >
          Войти
        </Button>
      </form>

      <p className={styles.note}>
        После {LOGIN_THROTTLE.maxFailures} неудачных попыток подряд вход в учётную запись
        закрывается на {BLOCK_MINUTES} минут — это защита от подбора пароля.
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className={styles.screen}>
      <section className={styles.brandSide}>
        <div className={styles.brandRow}>
          <Logo size={34} />
          <span>
            <span className={styles.brandName}>SkillLink</span>
            <span className={styles.brandSub} style={{ display: 'block' }}>
              Вузы × IT-компании
            </span>
          </span>
        </div>

        <h2 className={styles.headline}>Партнёрство с вузами под контролем</h2>
        <p className={styles.lead}>
          Вузы, образовательные программы и IT-продукты в одной связке: четырнадцать этапов
          работы, честная аналитика и рекомендации с обоснованием.
        </p>

        <div className={styles.points}>
          <p className={styles.point}>
            <span className={styles.pointIcon}>
              <Icon name="cooperation" size={16} />
            </span>
            Все этапы сотрудничества с историей изменений и ответственными.
          </p>
          <p className={styles.point}>
            <span className={styles.pointIcon}>
              <Icon name="analytics" size={16} />
            </span>
            Рейтинг программ, который объясняет, из чего он сложился.
          </p>
          <p className={styles.point}>
            <span className={styles.pointIcon}>
              <Icon name="alert" size={16} />
            </span>
            Система не даёт закрыть этап, работа по которому не сделана.
          </p>
        </div>
      </section>

      <section className={styles.formSide}>
        {/* useSearchParams требует границы Suspense: без неё страница не пройдёт сборку. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  )
}
