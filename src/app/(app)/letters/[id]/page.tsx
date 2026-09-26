'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  INBOUND_LETTER_GROUP_LABELS,
  INBOUND_LETTER_SOURCE_LABELS,
  INBOUND_LETTER_VERDICT_LABELS,
  type InboundLetterDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  InboundLetterStatusBadge,
  MockBadge,
  NO_DATA,
  PageHeader,
  Section,
  SkeletonLines,
  Textarea,
  apiPatch,
  apiPost,
  cooperationHref,
  formatDateTime,
  universityHref,
  useCurrentUser,
  useMutation,
  useToast,
  useResource,
  ROUTES,
} from '@/ui'
import { DismissModal, ReviewModal } from '../LetterReviewModals'
import { analyzedByNote, formatLetterConfidence, highlightQuotes } from '../letters-view'
import styles from './letter.module.css'

const REPLY_TEXTAREA_ID = 'letter-reply-draft-text'

/**
 * Карточка обращения (решение 170/171).
 *
 * Слева — письмо как пришло, справа — что поняла система. Кнопки разбора
 * («Верно», «Неверно», «Не по работе», «Разобрать заново») — только с правом
 * `INBOUND_REVIEW` (ADMIN, HEAD): эксперт и менеджер только читают карточку,
 * как и весь реестр (право `INBOUND_READ`).
 */
export default function LetterPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const user = useCurrentUser()
  const toast = useToast()

  const letter = useResource<InboundLetterDto>(`/api/inbound-letters/${id}`)
  const [reviewMode, setReviewMode] = useState<'CORRECT' | 'INCORRECT' | null>(null)
  const [dismissOpen, setDismissOpen] = useState(false)

  const reanalyze = useMutation(
    async () => (await apiPost<InboundLetterDto>(`/api/inbound-letters/${id}/analyze`)).data,
  )

  async function onReanalyze() {
    const result = await reanalyze.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Письмо разобрано заново')
    letter.reload()
  }

  const card = letter.data

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Письма вузов', href: ROUTES.letters }, { label: card?.subject ?? 'Письмо' }]}
        title={card?.subject ?? 'Письмо'}
        description={card ? `От ${card.senderName ?? card.senderEmail} · ${formatDateTime(card.receivedAt)}` : undefined}
        meta={
          card ? (
            <>
              <InboundLetterStatusBadge status={card.status} />
              {card.isMock && <MockBadge />}
            </>
          ) : undefined
        }
        actions={
          card && user.permissions.canReviewLetters && (card.status === 'NEW' || card.status === 'ANALYZED') ? (
            <div className={styles.actions}>
              <Button variant="ghost" icon="refresh" onClick={onReanalyze} isLoading={reanalyze.isPending}>
                Разобрать заново
              </Button>
              <Button variant="secondary" icon="block" onClick={() => setDismissOpen(true)}>
                Не по работе
              </Button>
              <Button
                variant="danger"
                icon="close"
                onClick={() => setReviewMode('INCORRECT')}
                disabled={card.status !== 'ANALYZED'}
                title={card.status !== 'ANALYZED' ? 'Сначала разберите письмо' : undefined}
              >
                Неверно
              </Button>
              <Button
                variant="primary"
                icon="check"
                onClick={() => setReviewMode('CORRECT')}
                disabled={card.status !== 'ANALYZED' || card.current.universityId === null}
                title={
                  card.status !== 'ANALYZED'
                    ? 'Сначала разберите письмо'
                    : card.current.universityId === null
                      ? 'Разбор не нашёл вуз — используйте «Неверно» и укажите его вручную'
                      : undefined
                }
              >
                Верно
              </Button>
            </div>
          ) : undefined
        }
      />

      {letter.isLoading ? (
        <Section>
          <Card>
            <SkeletonLines count={8} />
          </Card>
        </Section>
      ) : letter.error ? (
        <Section>
          <ErrorState error={letter.error} onRetry={letter.reload} />
        </Section>
      ) : card ? (
        <>
          <Section>
            <div className={styles.layout}>
            <Card className={styles.letterCard}>
              <h2 className={styles.blockTitle}>Письмо</h2>
              <dl className={styles.facts}>
                <Fact label="От кого" value={card.senderName ? `${card.senderName} · ${card.senderEmail}` : card.senderEmail} />
                <Fact label="Когда" value={formatDateTime(card.receivedAt)} />
                <Fact label="Тема" value={card.subject} />
                <Fact label="Источник" value={INBOUND_LETTER_SOURCE_LABELS[card.source]} />
              </dl>
              <div className={styles.body}>
                {highlightQuotes(card.bodyText, card.current.quotes.length > 0 ? card.current.quotes : card.detected.quotes).map(
                  (segment, index) =>
                    segment.isQuote ? (
                      <mark key={index} className={styles.quote}>
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                )}
              </div>
            </Card>

            <Card className={styles.analysisCard}>
              <h2 className={styles.blockTitle}>Что поняла система</h2>
              <dl className={styles.facts}>
                <Fact
                  label="Вуз"
                  value={
                    card.current.universityId ? (
                      <a className={styles.link} href={universityHref(card.current.universityId)}>
                        {card.current.universityName ?? 'Вуз'}
                      </a>
                    ) : (
                      NO_DATA
                    )
                  }
                />
                <Fact
                  label="Связка"
                  value={
                    card.current.cooperationId ? (
                      <a className={styles.link} href={cooperationHref(card.current.cooperationId)}>
                        Открыть связку
                      </a>
                    ) : (
                      NO_DATA
                    )
                  }
                />
                <Fact label="Этап" value={card.current.stageNumber !== null ? `${card.current.stageNumber} из 14` : NO_DATA} />
                <Fact
                  label="Группа"
                  value={card.current.group ? <Badge tone="accent">{INBOUND_LETTER_GROUP_LABELS[card.current.group]}</Badge> : NO_DATA}
                />
                <Fact label="Предлагаемое действие" value={card.current.action ?? NO_DATA} />
                <Fact label="Уверенность" value={formatLetterConfidence(card.current.confidence)} />
                <Fact label="Разбор" value={analyzedByNote(card.current)} />
              </dl>

              {card.current.quotes.length > 0 && (
                <div className={styles.block}>
                  <h3 className={styles.blockSubtitle}>Цитаты-основания</h3>
                  <ul className={styles.quotesList}>
                    {card.current.quotes.map((quote, index) => (
                      <li key={index} className={styles.quoteItem}>
                        «{quote}»
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {card.review && (
                <ReviewSummary card={card} />
              )}
            </Card>
            </div>
          </Section>

          {user.permissions.canReviewLetters && card.status !== 'NEW' && card.status !== 'DISMISSED' && (
            <Section title="Ответ">
              <Card>
                <ReplyDraft letterId={card.id} draft={card.replyDraft} onChanged={letter.reload} />
              </Card>
            </Section>
          )}

          {reviewMode && (
            <ReviewModal
              key={reviewMode}
              isOpen
              mode={reviewMode}
              letter={card}
              onClose={() => setReviewMode(null)}
              onDone={() => {
                setReviewMode(null)
                letter.reload()
              }}
            />
          )}

          {dismissOpen && (
            <DismissModal
              isOpen
              letterId={card.id}
              onClose={() => setDismissOpen(false)}
              onDone={() => {
                setDismissOpen(false)
                letter.reload()
              }}
            />
          )}
        </>
      ) : null}
    </>
  )
}

/** Блок итога проверки: кто, когда, вердикт, задание; для исправленных — «было → стало». */
function ReviewSummary({ card }: { card: InboundLetterDto }) {
  const review = card.review
  if (!review) return null

  const changes: Array<{ label: string; before: string; after: string }> = []
  if (card.status === 'CORRECTED') {
    if (card.detected.universityId !== card.current.universityId) {
      changes.push({
        label: 'Вуз',
        before: card.detected.universityName ?? NO_DATA,
        after: card.current.universityName ?? NO_DATA,
      })
    }
    if (card.detected.cooperationId !== card.current.cooperationId) {
      changes.push({
        label: 'Связка',
        before: card.detected.cooperationId ? 'указана' : 'не указана',
        after: card.current.cooperationId ? 'указана' : 'не указана',
      })
    }
    if (card.detected.group !== card.current.group) {
      changes.push({
        label: 'Группа',
        before: card.detected.group ? INBOUND_LETTER_GROUP_LABELS[card.detected.group] : NO_DATA,
        after: card.current.group ? INBOUND_LETTER_GROUP_LABELS[card.current.group] : NO_DATA,
      })
    }
    if (card.detected.action !== card.current.action) {
      changes.push({ label: 'Действие', before: card.detected.action ?? NO_DATA, after: card.current.action ?? NO_DATA })
    }
  }

  return (
    <div className={styles.block}>
      <h3 className={styles.blockSubtitle}>Итог проверки</h3>
      <p className={styles.reviewLine}>
        {review.reviewedByName ?? 'Сотрудник'} · {formatDateTime(review.reviewedAt)} ·{' '}
        <strong>{review.verdict ? INBOUND_LETTER_VERDICT_LABELS[review.verdict] : NO_DATA}</strong>
      </p>
      {changes.length > 0 && (
        <ul className={styles.changesList}>
          {changes.map((change) => (
            <li key={change.label}>
              {change.label}: «{change.before}» → «{change.after}»
            </li>
          ))}
        </ul>
      )}
      {review.comment && <p className={styles.comment}>«{review.comment}»</p>}
      {card.task && (
        <p className={styles.reviewLine}>
          Задание: {card.task.title} — {card.task.responsibleName ?? 'без ответственного'}
        </p>
      )}
    </div>
  )
}

/** Черновик ответа вузу: правка, «Открыть в почте», «Скопировать» (решение 170/171). */
function ReplyDraft({
  letterId,
  draft,
  onChanged,
}: {
  letterId: string
  draft: InboundLetterDto['replyDraft']
  onChanged: () => void
}) {
  const toast = useToast()
  const [text, setText] = useState(draft?.text ?? '')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setText(draft?.text ?? '')
  }, [draft?.text])

  const compose = useMutation(
    async () => (await apiPost<InboundLetterDto>(`/api/inbound-letters/${letterId}/reply-draft`)).data,
  )
  const save = useMutation(
    async (input: { text: string }) =>
      (await apiPatch<InboundLetterDto>(`/api/inbound-letters/${letterId}/reply-draft`, input)).data,
  )

  async function onCompose() {
    const result = await compose.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Черновик собран')
    onChanged()
  }

  async function onSave() {
    const result = await save.run({ text })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Черновик сохранён')
    onChanged()
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Текст скопирован')
    } catch {
      // Буфер обмена недоступен (не HTTPS, запрет браузера) — выделяем текст,
      // чтобы скопировать его сочетанием клавиш (тот же приём, что у временного
      // пароля, settings/UserModals.tsx).
      const node = document.getElementById(REPLY_TEXTAREA_ID)
      if (node instanceof HTMLTextAreaElement) node.select()
      toast.info('Скопировать не удалось — текст выделен, нажмите Ctrl+C или ⌘C')
    }
  }

  if (!draft) {
    return (
      <div className={styles.replyEmpty}>
        <p className={styles.note}>Черновика ещё нет.</p>
        <Button variant="secondary" icon="mail" onClick={onCompose} isLoading={compose.isPending}>
          Собрать черновик ответа
        </Button>
      </div>
    )
  }

  const dirty = text !== draft.text

  return (
    <div className={styles.reply}>
      <Textarea
        id={REPLY_TEXTAREA_ID}
        label="Черновик ответа"
        rows={8}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setCopied(false)
        }}
      />
      <div className={styles.replyActions}>
        <Button variant="primary" icon="check" onClick={onSave} disabled={!dirty} isLoading={save.isPending}>
          Сохранить правку
        </Button>
        <Button variant="secondary" icon="refresh" onClick={onCompose} isLoading={compose.isPending}>
          Собрать заново
        </Button>
        <Button variant="secondary" icon={copied ? 'check' : undefined} onClick={onCopy}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
        <Button variant="ghost" icon="mail" href={draft.mailto} external>
          Открыть в почте
        </Button>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  )
}
