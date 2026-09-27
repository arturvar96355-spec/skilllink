'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  AI_DRAFT_SOURCE_LABELS,
  aiDraftSourceNote,
  type AiDraftDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  HelpHint,
  Icon,
  SkeletonLines,
  Textarea,
  apiPost,
  formatDateTime,
  useMutation,
  useToast,
  type HelpHintProps,
} from '@/ui'
import { LetterRewrite, rewrittenNote, useDraftRewrite } from './LetterRewrite'
import styles from './AiDraft.module.css'

/**
 * Строка «кто написал черновик»: бирка и пояснение (решение 90). Общая для черновика
 * помощника и черновика ответа на письмо вуза (решение 213) — везде одинаково.
 */
export function DraftSourceLine({ byModel, badge, note }: { byModel: boolean; badge: string; note: ReactNode }) {
  return (
    <div className={styles.source}>
      <Badge tone={byModel ? 'accent' : 'neutral'} withDot>
        {badge}
      </Badge>
      <span className={styles.note}>{note}</span>
    </div>
  )
}

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
  // Письмо вузу правится и переделывается кнопками (решение 213); сводка и дела — только читаются.
  const editable = Boolean(draft.rewriteTarget)
  const letter = useDraftRewrite(draft.text)
  const fieldId = useId()
  const { reset } = letter

  useEffect(() => {
    reset(draft.text)
  }, [draft.text, reset])

  const text = editable ? letter.text : draft.text

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Черновик скопирован')
    } catch {
      const node = document.getElementById(fieldId)
      if (node instanceof HTMLTextAreaElement) node.select()
      toast.error('Не удалось скопировать — выделите текст и скопируйте вручную')
    }
  }

  return (
    <div className={styles.draft}>
      {editable && letter.style ? (
        <DraftSourceLine byModel badge="ИИ · переделка" note={rewrittenNote(letter.style)} />
      ) : (
        <DraftSourceLine
          byModel={byModel}
          badge={byModel ? `ИИ · ${AI_DRAFT_SOURCE_LABELS[draft.source]}` : 'Шаблон'}
          note={aiDraftSourceNote(draft)}
        />
      )}

      {draft.rewriteTarget ? (
        <>
          <div className={letter.fieldClassName} aria-busy={letter.pending}>
            <Textarea
              id={fieldId}
              label="Текст письма"
              hint="Можно править прямо здесь — кнопки ниже переделают текст вместе с вашими правками."
              rows={10}
              value={letter.text}
              readOnly={letter.pending}
              onChange={(event) => letter.setText(event.target.value)}
            />
          </div>
          <LetterRewrite target={draft.rewriteTarget} {...letter.barProps} />
        </>
      ) : (
        <p className={styles.text}>{draft.text}</p>
      )}

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
  /** «?» у заголовка — что делает помощник здесь (решение 217). */
  help?: HelpHintProps
  description: string
  actionLabel: string
  /** Маршрут генерации: POST без тела. */
  endpoint: string
}

/**
 * Блок помощника с кнопкой. Ничего не генерируется при открытии страницы —
 * только по нажатию: каждый вызов модели стоит денег и идёт в лимит.
 */
export function AiAssistCard({ title, help, description, actionLabel, endpoint }: AiAssistCardProps) {
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
            {help && <HelpHint {...help} />}
          </span>
          <p className={styles.description}>{description}</p>
          <p className={styles.note}>Цифры считает код, текст пишет YandexGPT, решение принимает человек</p>
        </div>
        <Button variant="secondary" icon="spark" onClick={run} isLoading={generate.isPending}>
          {draft ? 'Составить заново' : actionLabel}
        </Button>
      </div>

      {generate.isPending && !draft ? <AiDraftLoading /> : draft ? <AiDraftView draft={draft} /> : null}
    </Card>
  )
}
