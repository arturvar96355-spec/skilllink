'use client'

import { useMemo, useState } from 'react'
import type { CooperationListItemDto } from '@/shared/contracts'
import { Select, SkeletonLines, buildQuery, useResource } from '@/ui'
import { AiAssistCard } from '../../AiDraft'
import styles from './university.module.css'

/** Связки, по которым есть что разбирать: закрытые — уже история. */
const OPEN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED']

/** Чем больше проблем, тем выше: просрочки, затем близкие сроки, затем самые свежие. */
function problemScore(item: CooperationListItemDto): number {
  return item.progress.overdueStages * 100 + item.progress.dueSoonStages * 10 + (item.status === 'PAUSED' ? 5 : 0)
}

/**
 * ИИ-помощник в карточке вуза (ТЗ дизайна 26–29.09, п. 4.3): разбор ситуации,
 * объяснение проблем и следующий шаг — не выходя из карточки.
 *
 * Отдельного разбора «по вузу целиком» на сервере пока нет, есть сводка по
 * связке (`POST /api/cooperations/:id/ai-summary`: этапы, просрочки, блокировки,
 * открытые рекомендации). Поэтому здесь — связки этого вуза: по умолчанию та, где
 * больше всего проблем, и выбор любой другой. Текст пишет ИИ-помощник, если он
 * подключён, иначе — шаблон; факты, на которых он построен, показываются под ним.
 */
export function UniversityAssistant({ universityId }: { universityId: string }) {
  const cooperations = useResource<CooperationListItemDto[]>(
    `/api/cooperations${buildQuery({ universityId, status: OPEN_STATUSES, pageSize: 100 })}`,
  )
  const ordered = useMemo(
    () => [...(cooperations.data ?? [])].sort((a, b) => problemScore(b) - problemScore(a)),
    [cooperations.data],
  )
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosen = ordered.find((item) => item.id === chosenId) ?? ordered[0] ?? null

  if (cooperations.isLoading) return <SkeletonLines count={2} />
  // Ошибку списка связок покажет вкладка «Связки»; помощник без них просто молчит.
  if (cooperations.error || !chosen) return null

  return (
    <div className={styles.assistant}>
      {ordered.length > 1 && (
        <Select
          label="О какой связке вуза"
          value={chosen.id}
          onValueChange={setChosenId}
          options={ordered.map((item) => ({
            value: item.id,
            label: `${item.programName}${item.productName ? ` → ${item.productName}` : ''}${
              item.progress.overdueStages > 0 ? ` · просрочено этапов: ${item.progress.overdueStages}` : ''
            }`,
          }))}
        />
      )}
      {/* key — чтобы при смене связки не оставался текст о прежней. */}
      <AiAssistCard
        key={chosen.id}
        title="ИИ-помощник по вузу"
        description={`${chosen.programName}${chosen.productName ? ` → ${chosen.productName}` : ''}: где связка сейчас, что мешает и что сделать дальше — по этапам, срокам и открытым рекомендациям.`}
        actionLabel="Разобрать ситуацию"
        endpoint={`/api/cooperations/${chosen.id}/ai-summary`}
      />
    </div>
  )
}
