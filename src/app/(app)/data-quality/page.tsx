'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  DUPLICATE_ENTITY_TYPES,
  type DuplicateEntityType,
  type DuplicatePairDto,
  type QualityReportDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  CardsSkeleton,
  EmptyState,
  ErrorState,
  Icon,
  MockBadge,
  PageHeader,
  Section,
  apiPost,
  buildQuery,
  formatDateTime,
  formatNumber,
  pluralize,
  useCurrentUser,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { QUALITY_LEVEL_LABELS, groupIssues, scoreLevel, type LeveledIssue, type QualityLevel } from './quality-view'
import styles from './quality.module.css'

/** Сколько записей проблемы показать сразу; остальные — «и ещё N». */
const ITEMS_SHOWN = 5

const DUPLICATE_TITLES: Record<DuplicateEntityType, string> = {
  university: 'Вузы',
  program: 'Программы',
  skill: 'Навыки',
  product: 'IT-продукты',
}

const LEVEL_TONE: Record<QualityLevel, 'danger' | 'warning' | 'success'> = {
  critical: 'danger',
  attention: 'warning',
  ok: 'success',
}

/** «Вуз без…» → «вуз без…», но «IT-продукт» остаётся как есть: аббревиатуру не ломаем. */
function lowerFirst(text: string): string {
  const [first = '', second = ''] = text
  return second === second.toUpperCase() && second !== second.toLowerCase() ? text : first.toLowerCase() + text.slice(1)
}

function formatScore(score: number | null): string {
  return score === null ? 'Нет данных' : score.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

/**
 * Качество данных (ТЗ дизайна 26–29.09, п. 4.4).
 *
 * Отчёт сервера (`GET /api/data-quality/report`, решение 134) — оценка справочника
 * 0–100 по пяти сущностям с формулой и списком проблем. Здесь он разложен по уровням
 * «Критично → Требует внимания → Всё хорошо» (см. quality-view.ts) и дополнен
 * кандидатами в дубли с причинами сходства. Каждая проблема ведёт к своим записям:
 * увидел → открыл → исправил.
 */
export default function DataQualityPage() {
  const report = useResource<QualityReportDto>('/api/data-quality/report')

  return (
    <>
      <PageHeader
        title="Качество данных"
        description="Чего не хватает в справочниках, что устарело и что похоже на дубль. Каждая строка ведёт к записям, которые нужно поправить."
        meta={report.data?.isMock ? <MockBadge /> : undefined}
      />
      {report.isLoading ? (
        <CardsSkeleton count={3} />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <QualityReport report={report.data} />
      ) : null}
    </>
  )
}

function QualityReport({ report }: { report: QualityReportDto }) {
  const groups = groupIssues(report)
  const verdict = scoreLevel(report.score)

  return (
    <>
      <Card className={styles.summary}>
        <div className={styles.score} data-level={verdict ?? undefined}>
          <span className={styles.scoreValue}>{formatScore(report.score)}</span>
          <span className={styles.scoreLabel}>
            из 100{verdict && ` · ${QUALITY_LEVEL_LABELS[verdict].toLowerCase()}`}
          </span>
        </div>
        <ul className={styles.entities}>
          {report.entities.map((entity) => {
            const level = scoreLevel(entity.score)
            return (
              <li key={entity.entity} className={styles.entity} data-level={level ?? undefined}>
                <span className={styles.entityTitle}>{entity.title}</span>
                <span className={styles.entityScore}>{formatScore(entity.score)}</span>
                <span className={styles.entityMeta}>
                  {formatNumber(entity.total)} {pluralize(entity.total, ['запись', 'записи', 'записей'])}
                </span>
              </li>
            )
          })}
        </ul>
        <details className={styles.formula}>
          <summary>Как считается оценка</summary>
          <p>{report.explanation}</p>
          <p>
            Уровень проблемы — по тому, сколько баллов она отнимает у оценки своего справочника: «критично» — от 10
            баллов, «требует внимания» — меньше.
          </p>
        </details>
        <p className={styles.generated}>Проверено {formatDateTime(report.generatedAt)}</p>
      </Card>

      <IssueGroup level="critical" items={groups.critical} empty="Критичных проблем нет." />
      <IssueGroup level="attention" items={groups.attention} empty="Мелких проблем тоже нет." />
      <OkGroup items={groups.ok} />

      <Duplicates counts={report.duplicates} />
    </>
  )
}

function IssueGroup({ level, items, empty }: { level: QualityLevel; items: LeveledIssue[]; empty: string }) {
  return (
    <Section
      title={`${QUALITY_LEVEL_LABELS[level]} · ${formatNumber(items.length)}`}
      description={
        level === 'critical'
          ? 'Проблемы, из-за которых заметно падает оценка справочника. Начинать с них.'
          : 'Не ломают работу, но портят выборки и рекомендации.'
      }
    >
      {items.length === 0 ? (
        <p className={styles.none}>{empty}</p>
      ) : (
        <div className={styles.issues}>
          {items.map((item) => (
            <IssueCard key={item.issue.code} item={item} level={level} />
          ))}
        </div>
      )}
    </Section>
  )
}

function IssueCard({ item, level }: { item: LeveledIssue; level: QualityLevel }) {
  const { issue } = item
  const hidden = issue.count - Math.min(issue.items.length, ITEMS_SHOWN)
  return (
    <article className={styles.issue} data-level={level}>
      <header className={styles.issueHead}>
        <span className={styles.issueEntity}>{item.entityTitle}</span>
        <Badge tone={LEVEL_TONE[level]}>−{issue.penalty.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} балла</Badge>
      </header>
      <h3 className={styles.issueTitle}>{issue.title}</h3>
      <p className={styles.issueCount}>
        {formatNumber(issue.count)} из {formatNumber(item.entityTotal)} ·{' '}
        {(issue.share * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%
      </p>
      <ul className={styles.items}>
        {issue.items.slice(0, ITEMS_SHOWN).map((record) => (
          <li key={record.id}>
            <Link className={styles.item} href={record.href}>
              {record.name}
              <Icon name="chevronRight" size={16} />
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className={styles.more}>и ещё {formatNumber(hidden)}</p>}
    </article>
  )
}

function OkGroup({ items }: { items: LeveledIssue[] }) {
  return (
    <Section title={`${QUALITY_LEVEL_LABELS.ok} · ${formatNumber(items.length)}`} description="Проверки, которые сейчас проходят.">
      {items.length === 0 ? (
        <p className={styles.none}>Пока ни одна проверка не пройдена без замечаний.</p>
      ) : (
        <ul className={styles.okList}>
          {items.map((item) => (
            <li key={item.issue.code} className={styles.ok}>
              <Icon name="check" size={16} />
              <span>
                <span className={styles.okEntity}>{item.entityTitle}:</span> {lowerFirst(item.issue.title)} — нет
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Duplicates({ counts }: { counts: Record<DuplicateEntityType, number> }) {
  const withPairs = DUPLICATE_ENTITY_TYPES.filter((entity) => counts[entity] > 0)
  const [entity, setEntity] = useState<DuplicateEntityType | null>(withPairs[0] ?? null)

  return (
    <Section
      title="Кандидаты в дубли"
      description="Пары записей, похожих по названию, ИНН или словарю синонимов. Система только предлагает — решает человек."
    >
      {withPairs.length === 0 ? (
        <EmptyState icon="check" title="Похожих записей нет" description="Ни в одном справочнике не найдено пар выше порога сходства." />
      ) : (
        <>
          <div className={styles.dupTabs} role="tablist" aria-label="Справочник">
            {DUPLICATE_ENTITY_TYPES.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={entity === key}
                className={styles.dupTab}
                disabled={counts[key] === 0}
                onClick={() => setEntity(key)}
              >
                {DUPLICATE_TITLES[key]} <span className={styles.dupCount}>{formatNumber(counts[key])}</span>
              </button>
            ))}
          </div>
          {entity && <DuplicatePairs key={entity} entity={entity} />}
        </>
      )}
    </Section>
  )
}

function DuplicatePairs({ entity }: { entity: DuplicateEntityType }) {
  const user = useCurrentUser()
  const toast = useToast()
  const pairs = useResource<DuplicatePairDto[]>(`/api/data-quality/duplicates${buildQuery({ entity })}`)
  const dismiss = useMutation(async (pair: DuplicatePairDto) =>
    (await apiPost('/api/data-quality/duplicates/dismiss', { entity, firstId: pair.a.id, secondId: pair.b.id })).data,
  )

  async function onDismiss(pair: DuplicatePairDto) {
    const result = await dismiss.run(pair)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`«${pair.a.name}» и «${pair.b.name}» отмечены как разные записи`)
    pairs.reload()
  }

  if (pairs.isLoading) return <CardsSkeleton count={2} />
  if (pairs.error) return <ErrorState error={pairs.error} onRetry={pairs.reload} />
  const rows = pairs.data ?? []
  if (rows.length === 0) return <p className={styles.none}>Пар не осталось.</p>

  return (
    <ul className={styles.pairs}>
      {rows.map((pair) => (
        <li key={`${pair.a.id}:${pair.b.id}`} className={styles.pair}>
          <div className={styles.pairNames}>
            <Link className={styles.item} href={pair.a.href}>
              {pair.a.name}
            </Link>
            <span className={styles.pairAnd}>и</span>
            <Link className={styles.item} href={pair.b.href}>
              {pair.b.name}
            </Link>
            <Badge tone="neutral">сходство {Math.round(pair.score * 100)}%</Badge>
          </div>
          <ul className={styles.reasons}>
            {pair.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {user.permissions.canWrite && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDismiss(pair)}
              isLoading={dismiss.isPending}
              disabled={dismiss.isPending}
            >
              Это разные записи
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
