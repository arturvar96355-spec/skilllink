'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Icon, PageHeader, formatDateTime, formatRelative } from '@/ui'
import styles from './status.module.css'

/**
 * Состояние системы словами (решение 107).
 *
 * Раньше «Состояние системы» в подвале открывало сырой JSON /api/health —
 * человек видел текст на чёрном фоне и думал, что сайт сломался. Теперь та же
 * проверка — страницей: работает ли система, подключена ли база, применена ли
 * схема и когда проверено.
 *
 * При сбое проверка отвечает кодом 503, но с тем же описанием в теле — поэтому
 * тело читается при любом коде: «не работает» — это результат, а не ошибка страницы.
 * Пока страница открыта, проверка повторяется раз в 30 секунд.
 */

interface Health {
  status: 'ok' | 'degraded' | 'misconfigured'
  database: string
  schema: 'ready' | 'missing' | 'unknown'
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
  ready: { ok: true, text: 'Применена' },
  missing: { ok: false, text: 'Не применена' },
  unknown: { ok: null, text: 'Не проверялась' },
}

export default function StatusPage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const body = (await response.json()) as { data?: Health }
      if (body.data) setLoad({ state: 'ready', health: body.data })
      else setLoad({ state: 'unreachable', at: new Date().toISOString() })
    } catch {
      setLoad({ state: 'unreachable', at: new Date().toISOString() })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [check])

  const health = load.state === 'ready' ? load.health : null
  const working = health?.status === 'ok'
  const verdict =
    load.state === 'loading'
      ? { tone: 'pending', title: 'Проверяем…', text: 'Спрашиваем сервер о его состоянии.' }
      : load.state === 'unreachable'
        ? { tone: 'bad', title: 'Не работает', text: 'Сервер не ответил на проверку. Возможно, пропала сеть или сервер перезапускается.' }
        : working
          ? { tone: 'good', title: 'Работает', text: 'Сервер отвечает, база подключена, схема данных применена.' }
          : { tone: 'bad', title: 'Работает с ошибками', text: 'Сервер отвечает, но часть проверок не прошла — подробности ниже.' }

  const database = health ? (DATABASE_TEXT[health.database] ?? { ok: false, text: health.database }) : null
  const schema = health ? SCHEMA_TEXT[health.schema] : null
  const checkedAt = health?.time ?? (load.state === 'unreachable' ? load.at : null)

  return (
    <>
      <PageHeader title="Состояние системы" description="Та же проверка, что смотрит сервер выкладки, — словами." />

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
        <Check label="Сервер" ok={load.state === 'loading' ? null : load.state === 'ready'} text={load.state === 'ready' ? 'Отвечает' : load.state === 'loading' ? '…' : 'Не отвечает'} />
        <Check label="База данных" ok={database?.ok ?? null} text={database?.text ?? '…'} />
        <Check label="Схема данных" ok={schema?.ok ?? null} text={schema?.text ?? '…'} />
        <Check
          label="Время проверки"
          ok={null}
          text={checkedAt ? formatDateTime(checkedAt) : '…'}
          note={checkedAt ? formatRelative(checkedAt) : undefined}
        />
      </dl>

      <p className={styles.footnote}>Страница проверяет сервер раз в 30 секунд, пока открыта.</p>
    </>
  )
}

function Check({ label, ok, text, note }: { label: string; ok: boolean | null; text: string; note?: string }) {
  return (
    <div className={[styles.check, ok === true ? styles.checkGood : ok === false ? styles.checkBad : ''].join(' ')}>
      <dt className={styles.checkLabel}>{label}</dt>
      <dd className={styles.checkValue}>
        {ok !== null && <Icon name={ok ? 'check' : 'alert'} size={18} />}
        {text}
      </dd>
      {note && <dd className={styles.checkNote}>{note}</dd>}
    </div>
  )
}
