'use client'

import { useEffect, useState } from 'react'
import type {
  ProductOfferLetterDto,
  ProductRecommendationDto,
  ProductRecommendationsDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InfoHint,
  MeasureBars,
  MockBadge,
  Modal,
  SkeletonLines,
  ApiRequestError,
  apiPost,
  buildQuery,
  pluralize,
  programHref,
  useResource,
} from '@/ui'
import { AiDraftLoading, AiDraftView } from './AiDraft'
import { CreateCooperationModal } from './cooperations/CreateCooperationModal'
import { cooperationGoal, offerRow, splitCommonReasons } from './product-offers-view'
import styles from './ProductOffers.module.css'

/**
 * «Что предложить вузу» (решение 223) — топ продуктов по дефицитам навыков в карточке
 * программы и вуза. Балл — полосой на общей шкале 0–100 (решение 215), под ней —
 * почему, уверенность и два действия: черновик письма вузу и новая связка.
 * Кнопки решает сервер (`actions`): эксперт видит письмо, но не создаёт связку.
 */
export function ProductOffers({ endpoint, scope }: { endpoint: string; scope: 'program' | 'university' }) {
  const resource = useResource<ProductRecommendationsDto>(`${endpoint}${buildQuery({ limit: 3 })}`)
  const [letterFor, setLetterFor] = useState<ProductRecommendationDto | null>(null)
  const [creating, setCreating] = useState<ProductRecommendationDto | null>(null)

  if (resource.isLoading) return <SkeletonLines count={4} />
  if (resource.error) return <ErrorState error={resource.error} onRetry={resource.reload} />
  const data = resource.data
  if (!data) return null
  const reasons = splitCommonReasons(data.items)

  return (
    <Card className={styles.card}>
      <div className={styles.lead}>
        <p className={styles.summary}>{data.summary}</p>
        {reasons.common.map((reason) => (
          <p key={reason} className={styles.common}>
            {reason}
          </p>
        ))}
        <span className={styles.method}>
          Балл 0–100 — насколько продукт закрывает дефициты навыков
          <InfoHint text={data.method} />
        </span>
        {data.isMock && (
          <MockBadge title="Спрос рынка — демонстрационный набор: баллы и цифры в причинах учебные." />
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon="product"
          title="Предложить нечего"
          description={
            data.period === null
              ? 'Нет рыночных данных о спросе — сравнивать продукты не с чем.'
              : 'Действующие продукты не закрывают дефицитов или уже подключены.'
          }
        />
      ) : (
        <ol className={styles.list}>
          {data.items.map((item) => (
            <li key={`${item.program.id}:${item.product.id}`} className={styles.offer}>
              <MeasureBars
                rows={[
                  offerRow(item, {
                    withProgram: scope === 'university',
                    ...(scope === 'university' ? { href: programHref(item.program.id) } : {}),
                  }),
                ]}
                max={100}
                label={`Балл рекомендации продукта ${item.product.name}`}
                valueWidth="6.5rem"
              />
              <ul className={styles.reasons}>
                {reasons.own(item).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {item.confidence !== 'HIGH' && (
                <p className={styles.confidence} data-low={item.lowData || undefined}>
                  {item.confidenceNote}
                </p>
              )}
              {(data.actions.canDraftLetter || data.actions.canCreateCooperation) && (
                <div className={styles.actions}>
                  {data.actions.canDraftLetter && (
                    <Button size="sm" variant="secondary" icon="mail" onClick={() => setLetterFor(item)}>
                      Черновик письма
                    </Button>
                  )}
                  {data.actions.canCreateCooperation && (
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => setCreating(item)}>
                      Создать связку
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {scope === 'program' && data.excluded.length > 0 && (
        <details className={styles.excluded}>
          <summary>Почему не предложены другие продукты — {data.excluded.length}</summary>
          <ul>
            {data.excluded.map((row) => (
              <li key={row.productId}>
                <span className={styles.excludedName}>{row.productName}</span> — {row.reason.charAt(0).toLowerCase()}
                {row.reason.slice(1)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.productsWithoutSkills.length > 0 && (
        <p className={styles.foot}>
          Не сравнивались — у продуктов не записаны навыки: {data.productsWithoutSkills.join(', ')}.
        </p>
      )}

      {letterFor && <ProductOfferLetterModal item={letterFor} onClose={() => setLetterFor(null)} />}
      {creating && (
        <CreateCooperationModal
          initial={{
            universityId: creating.program.universityId,
            programId: creating.program.id,
            productId: creating.product.id,
            goal: cooperationGoal(creating),
          }}
          onClose={(created) => {
            setCreating(null)
            if (created) resource.reload()
          }}
        />
      )}
    </Card>
  )
}

/**
 * Черновик письма вузу с предложением продукта: составляется при открытии окна —
 * по нажатию «Черновик письма», а не при открытии карточки (каждый вызов модели
 * идёт в лимит). Кому — маской; текст правится и переделывается кнопками (решение 213).
 */
export function ProductOfferLetterModal({ item, onClose }: { item: ProductRecommendationDto; onClose: () => void }) {
  const [draft, setDraft] = useState<ProductOfferLetterDto | null>(null)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const endpoint = `/api/programs/${item.program.id}/product-recommendations/${item.product.id}/letter`

  useEffect(() => {
    let cancelled = false
    setError(null)
    apiPost<ProductOfferLetterDto>(endpoint)
      .then((result) => {
        if (!cancelled) setDraft(result.data)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(caught instanceof ApiRequestError ? caught : new ApiRequestError('Непредвиденная ошибка', 'INTERNAL', 0))
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, attempt])

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Черновик письма вузу"
      help={{ topic: 'product-recommendations', section: 'letter' }}
      description={`Предложение продукта «${item.product.name}» для программы «${item.program.name}».`}
      wide
      footer={
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => setAttempt((value) => value + 1)} />
      ) : draft ? (
        <div className={styles.letter}>
          <dl className={styles.letterFacts}>
            <div>
              <dt>Кому</dt>
              <dd>
                {draft.recipient.maskedName ? (
                  <>
                    Основной контакт вуза — <span className={styles.masked}>{draft.recipient.maskedName}</span>
                    {draft.recipient.position ? `, ${draft.recipient.position.toLowerCase()}` : ''}
                  </>
                ) : (
                  'Контактов у вуза нет — укажите получателя сами'
                )}
                <span className={styles.letterHint}> · {draft.universityName}. Имя в письмо не вставлено: его подставите вы.</span>
              </dd>
            </div>
            <div>
              <dt>Балл</dt>
              <dd>
                {item.score} из 100 · закроет {item.closes.length}{' '}
                {pluralize(item.closes.length, ['дефицитный навык', 'дефицитных навыка', 'дефицитных навыков'])}
              </dd>
            </div>
          </dl>
          {draft.isMock && (
            <p className={styles.mockWarning}>
              <Badge tone="mock">демо</Badge>
              Цифры спроса в письме — демонстрационный набор. Вузу такое письмо не отправляйте.
            </p>
          )}
          <AiDraftView draft={draft} />
        </div>
      ) : (
        <AiDraftLoading />
      )}
    </Modal>
  )
}
