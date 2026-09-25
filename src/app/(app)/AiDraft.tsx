'use client'

import { useState } from 'react'
import {
  AI_DRAFT_SOURCE_LABELS,
  aiDraftSourceNote,
  type AiDraftDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  Icon,
  SkeletonLines,
  apiPost,
  formatDateTime,
  useMutation,
  useToast,
} from '@/ui'
import styles from './AiDraft.module.css'

/**
 * Черновик ИИ-помощника (решение 90) — текст, пометка источника, «Скопировать»
 * и факты, из которых он собран.
 *
 * Источник виден всегда: «Черновик ИИ (YandexGPT) — проверьте перед отправкой»
 * или «Шаблон без ИИ: помощник не подключён». Выдавать шаблон за ИИ и наоборот
 * нельзя — как и демо-данные за статистику.
 */
export function AiDraftView({ draft }: { draft: AiDraftDto }) {
  const toast = useToast()
  const byModel = draft.source !== 'template'

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.text)
      toast.success('Черновик скопирован')
    } catch {
      toast.error('Не удалось скопировать — выделите текст и скопируйте вручную')
    }
  }

  return (
    <div className={styles.draft}>
      <div className={styles.source}>
        <Badge tone={byModel ? 'accent' : 'neutral'} withDot>
          {byModel ? `ИИ · ${AI_DRAFT_SOURCE_LABELS[draft.source]}` : 'Шаблон'}
        </Badge>
        <span className={styles.note}>{aiDraftSourceNote(draft)}</span>
      </div>

      <p className={styles.text}>{draft.text}</p>

      <div className={styles.foot}>
        <Button size="sm" variant="secondary" onClick={copy}>
          Скопировать
        </Button>
        <span className={styles.meta}>
          {formatDateTime(draft.generatedAt)}
          {draft.model ? ` · ${draft.model}` : ''}
          {draft.cached ? ' · повтор: те же факты недавно уже формулировались' : ''}
        </span>
      </div>

      {draft.facts.length > 0 && (
        <details className={styles.facts}>
          <summary>
            {byModel ? 'Что ушло в модель' : 'Из каких фактов собран текст'} — {draft.facts.length}
          </summary>
          <ul>
            {draft.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Черновик ещё пишется: модели нужно несколько секунд. */
export function AiDraftLoading() {
  return (
    <div className={styles.draft} aria-busy="true">
      <span className={styles.note}>Составляю черновик — это может занять до 15 секунд…</span>
      <SkeletonLines count={4} />
    </div>
  )
}

export interface AiAssistCardProps {
  title: string
  description: string
  actionLabel: string
  /** Маршрут генерации: POST без тела. */
  endpoint: string
}

/**
 * Блок помощника с кнопкой. Ничего не генерируется при открытии страницы —
 * только по нажатию: каждый вызов модели стоит денег и идёт в лимит.
 */
export function AiAssistCard({ title, description, actionLabel, endpoint }: AiAssistCardProps) {
  const toast = useToast()
  const [draft, setDraft] = useState<AiDraftDto | null>(null)
  const generate = useMutation(async () => (await apiPost<AiDraftDto>(endpoint)).data)

  async function run() {
    const result = await generate.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setDraft(result.data)
  }

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div className={styles.intro}>
          <span className={styles.title}>
            <Icon name="spark" size={16} />
            {title}
          </span>
          <p className={styles.description}>{description}</p>
        </div>
        <Button variant="secondary" icon="spark" onClick={run} isLoading={generate.isPending}>
          {draft ? 'Составить заново' : actionLabel}
        </Button>
      </div>

      {generate.isPending && !draft ? <AiDraftLoading /> : draft ? <AiDraftView draft={draft} /> : null}
    </Card>
  )
}
