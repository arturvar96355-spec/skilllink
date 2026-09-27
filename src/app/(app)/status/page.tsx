'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon, InfoHint, PageHeader, formatDateTime, formatRelative } from '@/ui'
import styles from './status.module.css'

/**
 * Состояние системы словами (решение 126).
 *
 * Раньше «Состояние системы» в подвале открывало сырой JSON /api/health —
 * человек видел текст на чёрном фоне и думал, что сайт сломался. Теперь та же
 * проверка — страницей: работает ли система, подключена ли база, обновлена ли
 * её структура и когда проверено. Слова — для человека, а не для инженера
 * (решение 211): «Структура базы: обновлена до текущей версии», а не «Схема
 * данных: применена»; у каждой строки — «?» с пояснением.
 *
 * При сбое проверка отвечает кодом 503, но с тем же описанием в теле — поэтому
 * тело читается при любом коде: «не работает» — это результат, а не ошибка страницы.
 * Пока страница открыта, проверка повторяется раз в 30 секунд.
 */

interface Health {
  status: 'ok' | 'degraded' | 'misconfigured'
  database: string
  schema: 'ready' | 'missing' | 'ahead' | 'unknown'
  time: string
}

type Load = { state: 'loading' } | { state: 'ready'; health: Health } | { state: 'unreachable'; at: string }

const REFRESH_MS = 30_000

const DATABASE_TEXT: Record<string, { ok: boolean | null; text: string }> = {
  connected: { ok: true, text: 'Подключена' },
  unavailable: { ok: false, text: 'Недоступна' },
  'not-configured': { ok: false, text: 'Не настроена' },
  unknown: { ok: null, text: 'Не проверялась' },
}

const SCHEMA_TEXT: Record<Health['schema'], { ok: boolean | null; text: string }> = {
  ready: { ok: true, text: 'Обновлена до текущей версии' },
  missing: { ok: false, text: 'Не обновлена — не хватает таблиц' },
  ahead: { ok: true, text: 'Новее этой версии программы' },
  unknown: { ok: null, text: 'Не проверялась' },
}

/** Пояснения «?» к строкам проверки — что это значит для пользователя. */
const HINTS = {
  server: 'Программа SkillLink запущена и отвечает на запросы — страницы открываются.',
  database: 'Программа видит базу данных, где хранятся вузы, программы, связки и документы.',
  schema: 'База содержит все таблицы, которые нужны этой версии программы. Если нет — часть страниц не откроется.',
  time: 'Когда страница в последний раз спрашивала сервер. Пока она открыта, проверка повторяется сама раз в 30 секунд.',
}

export default function StatusPage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [checking, setChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const check = useCallback(async () => {
    // Новая проверка отменяет предыдущую в полёте — так же, как useResource
    // отменяет устаревший запрос (docs/FRONTEND.md).
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setChecking(true)
    try {
      // База и схема — в проверке готовности (/api/ready); /api/health отвечает
      // только за сам процесс сервера и полей database/schema не содержит.
      const response = await fetch('/api/ready', { cache: 'no-store', signal: controller.signal })
      const body = (await response.json()) as { data?: Health }
      if (body.data) setLoad({ state: 'ready', health: body.data })
      else setLoad({ state: 'unreachable', at: new Date().toISOString() })
    } catch {
      if (controller.signal.aborted) return
      setLoad({ state: 'unreachable', at: new Date().toISOString() })
    } finally {
      if (!controller.signal.aborted) setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), REFRESH_MS)
    return () => {
      window.clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [check])

  const health = load.state === 'ready' ? load.health : null
  const working = health?.status === 'ok'
  const verdict =
    load.state === 'loading'
      ? { tone: 'pending', title: 'Проверяем…', text: 'Спрашиваем сервер о его состоянии.' }
      : load.state === 'unreachable'
        ? { tone: 'bad', title: 'Не работает', text: 'Сервер не ответил на проверку. Возможно, пропала сеть или сервер перезапускается.' }
        : working
          ? { tone: 'good', title: 'Работает', text: 'Сервер отвечает, база данных подключена, её структура соответствует версии программы.' }
          : { tone: 'bad', title: 'Работает с ошибками', text: 'Сервер отвечает, но часть проверок не прошла — подробности ниже.' }

  const database = health ? (DATABASE_TEXT[health.database] ?? { ok: false, text: health.database }) : null
  const schema = health ? (SCHEMA_TEXT[health.schema] ?? SCHEMA_TEXT.unknown) : null
  const checkedAt = health?.time ?? (load.state === 'unreachable' ? load.at : null)

  return (
    <>
      <PageHeader
        title="Состояние системы"
        help={{ topic: 'status' }}
        description="Работает ли SkillLink прямо сейчас: сервер, база данных и её структура. Та же проверка, по которой сервер выкладки решает, запускать ли новую версию."
      />

      <section className={[styles.verdict, styles[verdict.tone]].join(' ')} aria-live="polite">
        <span className={styles.beacon} aria-hidden>
          <span className={styles.beaconCore} />
        </span>
        <div className={styles.verdictText}>
          <h2 className={styles.verdictTitle}>{verdict.title}</h2>
          <p className={styles.verdictNote}>{verdict.text}</p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={() => void check()} isLoading={checking}>
          Проверить снова
        </Button>
      </section>

      <dl className={styles.checks}>
        <Check
          label="Сервер"
          hint={HINTS.server}
          ok={load.state === 'loading' ? null : load.state === 'ready'}
          text={load.state === 'ready' ? 'Отвечает' : load.state === 'loading' ? '…' : 'Не отвечает'}
        />
        <Check label="База данных" hint={HINTS.database} ok={database?.ok ?? null} text={database?.text ?? '…'} />
        <Check label="Структура базы" hint={HINTS.schema} ok={schema?.ok ?? null} text={schema?.text ?? '…'} />
        <Check
          label="Время проверки"
          hint={HINTS.time}
          ok={null}
          text={checkedAt ? formatDateTime(checkedAt) : '…'}
          note={checkedAt ? formatRelative(checkedAt) : undefined}
        />
      </dl>

      <p className={styles.footnote}>Страница проверяет сервер раз в 30 секунд, пока открыта.</p>
    </>
  )
}

function Check({
  label,
  hint,
  ok,
  text,
  note,
}: {
  label: string
  hint: string
  ok: boolean | null
  text: string
  note?: string
}) {
  return (
    <div className={[styles.check, ok === true ? styles.checkGood : ok === false ? styles.checkBad : ''].join(' ')}>
      <dt className={styles.checkLabel}>
        {label}
        <InfoHint text={hint} />
      </dt>
      <dd className={styles.checkValue}>
        {ok !== null && <Icon name={ok ? 'check' : 'alert'} size={18} />}
        {text}
      </dd>
      {note && <dd className={styles.checkNote}>{note}</dd>}
    </div>
  )
}
