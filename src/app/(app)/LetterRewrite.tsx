'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import {
  AI_REWRITE_STYLES,
  AI_REWRITE_STYLE_HINTS,
  AI_REWRITE_STYLE_LABELS,
  type AiRewriteDto,
  type AiRewriteStatusDto,
  type AiRewriteStyle,
  type AiRewriteTargetDto,
} from '@/shared/contracts'
import { Button, HelpHint, apiPost, useMutation, useResource, useToast } from '@/ui'
import {
  addVersion,
  currentVersion,
  editVersion,
  initialVersions,
  resetVersions,
  stepVersion,
  type DraftVersionsState,
} from './draft-versions'
import styles from './LetterRewrite.module.css'

/** Сколько держится подсветка поля после смены варианта, мс — чуть дольше самой анимации. */
const FRESH_MS = 700

/**
 * Состояние поля черновика с вариантами: текст, правка руками, сброс на новый
 * черновик с сервера и всё, что нужно ряду кнопок (`LetterRewrite`) и самому полю
 * (затемнение на время переделки, короткая подсветка нового варианта).
 */
export function useDraftRewrite(initialText: string) {
  const [versions, setVersions] = useState(() => initialVersions(initialText))
  const [pending, setPending] = useState(false)
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (!fresh) return
    const timer = setTimeout(() => setFresh(false), FRESH_MS)
    return () => clearTimeout(timer)
  }, [fresh])

  const setText = useCallback((text: string) => setVersions((state) => editVersion(state, text)), [])
  const reset = useCallback((text: string) => setVersions((state) => resetVersions(state, text)), [])
  const onChange = useCallback((next: DraftVersionsState) => {
    setVersions(next)
    setFresh(true)
  }, [])

  return {
    text: currentVersion(versions).text,
    /** Каким заданием сделан текущий вариант; null — исходный черновик (с правками или без). */
    style: currentVersion(versions).style,
    setText,
    reset,
    pending,
    barProps: { versions, onChange, onPendingChange: setPending },
    fieldClassName: [styles.field, fresh ? styles.fresh : ''].filter(Boolean).join(' '),
  }
}

/** Подпись к варианту, который переписал ИИ: бирка над полем говорит о текущем тексте. */
export function rewrittenNote(style: AiRewriteStyle): string {
  return `Вариант «${AI_REWRITE_STYLE_LABELS[style]}» переписал ИИ — проверьте перед отправкой`
}

export interface LetterRewriteProps {
  target: AiRewriteTargetDto
  versions: DraftVersionsState
  onChange: (next: DraftVersionsState) => void
  /** Идёт переделка — родитель на это время делает поле только для чтения. */
  onPendingChange?: (pending: boolean) => void
}

/**
 * Кнопки переделки черновика письма (решение 213): «Короче», «Мягче», «Настойчивее»,
 * «Официальнее», «Проще», «Подробнее». В модель уходит текущий текст — с правками
 * сотрудника — и задание кнопки; персональные данные перед этим вычищаются так же,
 * как у исходного черновика. Каждый результат — новый вариант: к прошлому можно
 * вернуться, ничего не теряется.
 *
 * Модель выключена или не настроена — кнопки неактивны, а под ними простыми словами
 * написано почему: подсказка по наведению на телефоне не видна.
 */
export function LetterRewrite({ target, versions, onChange, onPendingChange }: LetterRewriteProps) {
  const toast = useToast()
  const labelId = useId()
  const status = useResource<AiRewriteStatusDto>('/api/ai/rewrite')
  const [pendingStyle, setPendingStyle] = useState<AiRewriteStyle | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rewrite = useMutation(
    async (input: { text: string; style: AiRewriteStyle }) =>
      (await apiPost<AiRewriteDto>('/api/ai/rewrite', { target, text: input.text, style: input.style })).data,
  )

  const current = currentVersion(versions)
  const available = status.data?.available ?? false
  const reason = status.error ? status.error.message : status.data?.reason ?? null
  const empty = current.text.trim() === ''
  const position = versions.index + 1
  const total = versions.list.length

  async function run(style: AiRewriteStyle) {
    setPendingStyle(style)
    setNotice(null)
    onPendingChange?.(true)
    const result = await rewrite.run({ text: current.text, style })
    onPendingChange?.(false)
    setPendingStyle(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setNotice(result.data.notice)
    if (!result.data.rewritten) return
    // Без всплывающего «готово»: текст в поле сменился и подсветился, строка
    // «Вариант N из M» объявляется программам чтения с экрана сама.
    onChange(addVersion(versions, result.data.text, style))
  }

  function step(delta: -1 | 1) {
    setNotice(null)
    onChange(stepVersion(versions, delta))
  }

  return (
    <div className={styles.rewrite} role="group" aria-labelledby={labelId} aria-busy={pendingStyle !== null}>
      <div className={styles.row}>
        <span className={styles.label}>
          <span id={labelId}>Переделать с ИИ</span>
          <HelpHint
            topic="letter-reply"
            section="rewrite"
            note="Факты, даты и числа ИИ не меняет, имена и контакты до него не доходят."
          />
        </span>
        <div className={styles.styles}>
          {AI_REWRITE_STYLES.map((style) => (
            <Button
              key={style}
              size="sm"
              variant="secondary"
              title={available ? AI_REWRITE_STYLE_HINTS[style] : undefined}
              onClick={() => run(style)}
              isLoading={pendingStyle === style}
              disabled={!available || empty || (pendingStyle !== null && pendingStyle !== style)}
            >
              {AI_REWRITE_STYLE_LABELS[style]}
            </Button>
          ))}
        </div>
      </div>

      {!status.isLoading && !available && reason && <p className={styles.reason}>{reason}</p>}
      {available && empty && <p className={styles.reason}>Черновик пустой — переделывать нечего.</p>}

      {total > 1 && (
        <div className={styles.versions}>
          <Button
            size="sm"
            variant="ghost"
            icon="arrowLeft"
            onClick={() => step(-1)}
            disabled={position === 1 || pendingStyle !== null}
          >
            Прошлый вариант
          </Button>
          <span className={styles.versionMeta} aria-live="polite">
            Вариант {position} из {total}
            {current.style ? ` — «${AI_REWRITE_STYLE_LABELS[current.style]}»` : ' — исходный'}
          </span>
          {position < total && (
            <Button
              size="sm"
              variant="ghost"
              icon="arrowRight"
              iconPosition="right"
              onClick={() => step(1)}
              disabled={pendingStyle !== null}
            >
              Следующий
            </Button>
          )}
        </div>
      )}

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
