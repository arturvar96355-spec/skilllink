'use client'

import Link from 'next/link'
import { useRef, useState, type CSSProperties } from 'react'
import {
  DUPLICATE_ENTITY_TYPES,
  type DuplicateEntityType,
  type DuplicatePairDto,
  type QualityReportDto,
} from '@/shared/contracts'
import {
  Button,
  EmptyState,
  ErrorState,
  InfoHint,
  Icon,
  MockBadge,
  PageHeader,
  Queue,
  QueueGroup,
  QueueRow,
  Section,
  SkeletonLines,
  TableSkeleton,
  apiPost,
  buildQuery,
  formatDateTime,
  formatNumber,
  pluralize,
  queueRowLabel,
  useCurrentUser,
  useMutation,
  useResource,
  useReveal,
  useToast,
} from '@/ui'
import type { QueueTone } from '@/ui/data/queue-row'
import {
  CRITICAL_PENALTY,
  ISSUE_WHY,
  QUALITY_CRITICAL_BELOW,
  QUALITY_LEVEL_LABELS,
  QUALITY_TARGET,
  deviationText,
  entitiesWorstFirst,
  formatPoints,
  groupIssues,
  issueAction,
  pointsWord,
  qualityConclusion,
  qualitySummary,
  scoreLevel,
  type LeveledIssue,
  type QualityLevel,
} from './quality-view'
import { MergeUniversitiesModal } from './MergeUniversitiesModal'
import styles from './quality.module.css'

/** Сколько записей проблемы показать в раскрытии; остальные — «и ещё N». */
const ITEMS_SHOWN = 5

const DUPLICATES_ANCHOR = 'kandidaty-v-dubli'

const DUPLICATE_TITLES: Record<DuplicateEntityType, string> = {
  university: 'Вузы',
  program: 'Программы',
  skill: 'Навыки',
  product: 'IT-продукты',
}

/** Полоска строки: красный — только «критично», остальное — фиолетовая гамма (решение 206). */
const LEVEL_TONE: Record<Exclude<QualityLevel, 'ok'>, QueueTone> = {
  critical: 'critical',
  attention: 'accent',
}

const RECORDS: [string, string, string] = ['запись', 'записи', 'записей']

/** Как считается индекс — одной фразой у «?» (решение 212); формула целиком — в «Как считается индекс». */
const INDEX_HINT =
  'Средняя оценка пяти справочников от 0 до 100: каждая проверка отнимает баллы по доле записей, которые её не проходят. Цель — 90.'

function formatScore(score: number | null): string {
  return score === null ? 'Нет данных' : formatPoints(score)
}

function share(value: number): string {
  return `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
}

/**
 * Качество данных (ТЗ дизайна 26–29.09, п. 4.4; раскладка — решение 209).
 *
 * Отчёт сервера (`GET /api/data-quality/report`, решение 134): индекс качества
 * 0–100 по пяти справочникам с формулой и списком проверок. Сверху — индекс
 * числом, вывод одной фразой и справочники полосами от худшего к лучшему с
 * чертой цели. Ниже — проверки очередью строк (как «Требует внимания» на
 * главной): группы «Критично → Требует внимания → Всё хорошо», у каждой — сколько
 * записей нарушают и одно действие; раскрытие — записи и расчёт баллов. Последний
 * блок — кандидаты в дубли с причинами сходства.
 */
export default function DataQualityPage() {
  const report = useResource<QualityReportDto>('/api/data-quality/report')

  return (
    <>
      <PageHeader
        title="Качество данных"
        description="Чего не хватает в справочниках, что устарело и что похоже на дубль. Каждая проверка ведёт к записям, которые нужно поправить."
        meta={report.data?.isMock ? <MockBadge /> : undefined}
      />
      {report.isLoading ? (
        <div className={styles.loading}>
          <SkeletonLines count={4} />
          <TableSkeleton rows={5} columns={2} />
        </div>
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <QualityReport report={report.data} onChanged={report.reload} />
      ) : null}
    </>
  )
}

function QualityReport({ report, onChanged }: { report: QualityReportDto; onChanged: () => void }) {
  const user = useCurrentUser()
  const groups = groupIssues(report)
  const [dupEntity, setDupEntity] = useState<DuplicateEntityType | null>(
    () => DUPLICATE_ENTITY_TYPES.find((entity) => report.duplicates[entity] > 0) ?? null,
  )

  function showDuplicates(entity: DuplicateEntityType) {
    setDupEntity(entity)
    document.getElementById(DUPLICATES_ANCHOR)?.scrollIntoView({ block: 'start' })
  }

  if (report.entities.every((entity) => entity.total === 0)) {
    return (
      <EmptyState
        icon="report"
        title="Проверять пока нечего"
        description="В справочниках нет записей. Добавьте вузы, программы или навыки — отчёт посчитается сам."
      />
    )
  }

  return (
    <>
      <QualityIndex report={report} />

      <Section
        title="Проверки"
        description={`Под названием — зачем проверка нужна. Справа — сколько записей её не проходят. «Критично» — отнимает у справочника от ${CRITICAL_PENALTY} баллов.`}
      >
        <Queue>
          <IssueGroup
            level="critical"
            items={groups.critical}
            empty="Критичных проблем нет."
            canWrite={user.permissions.canWrite}
            onDuplicates={showDuplicates}
          />
          <IssueGroup
            level="attention"
            items={groups.attention}
            empty="Мелких проблем тоже нет."
            canWrite={user.permissions.canWrite}
            onDuplicates={showDuplicates}
          />
          <QueueGroup label={QUALITY_LEVEL_LABELS.ok} count={groups.ok.length}>
            {groups.ok.length === 0 ? (
              <li className={styles.none}>Пока ни одна проверка не пройдена без замечаний.</li>
            ) : (
              groups.ok.map((item) => (
                <li key={item.issue.code} className={styles.ok}>
                  <Icon name="check" size={16} className={styles.okMark} />
                  <span className={styles.okText}>
                    <span className="visually-hidden">Проходит: </span>
                    {item.issue.title}
                    {ISSUE_WHY[item.issue.code] && <span className={styles.okWhy}>{ISSUE_WHY[item.issue.code]}</span>}
                  </span>
                  <span className={styles.okCount}>
                    0 из {formatNumber(item.entityTotal)}
                  </span>
                </li>
              ))
            )}
          </QueueGroup>
        </Queue>
      </Section>

      <Duplicates counts={report.duplicates} entity={dupEntity} onEntity={setDupEntity} onChanged={onChanged} />
    </>
  )
}

/**
 * Индекс качества — числом и одной фразой, справочники — горизонтальными полосами
 * с чертой цели (единый язык диаграмм: плоско, число на полосе всегда, отклонение
 * словами, сортировка «где хуже»). Без плиток: пять одинаковых плашек ничего не
 * сравнивали — на полосах разница видна сразу.
 */
function QualityIndex({ report }: { report: QualityReportDto }) {
  const verdict = scoreLevel(report.score)
  const listRef = useRef<HTMLUListElement>(null)
  const inView = useReveal(listRef)
  const entities = entitiesWorstFirst(report)

  return (
    <section className={styles.index} aria-labelledby="quality-index-title">
      {/* Сначала — что править, простыми словами (решение 212): индекс без этой
          фразы эксперт не понял, «сколько это — 72,6». */}
      <p className={styles.summary}>{qualitySummary(report)}</p>
      <div className={styles.indexHead}>
        <h2 id="quality-index-title" className={styles.indexTitle}>
          Индекс качества
          <InfoHint text={INDEX_HINT} />
        </h2>
        <span className={styles.generated}>Проверено {formatDateTime(report.generatedAt)}</span>
      </div>

      <p className={styles.indexValue}>
        <span className={styles.indexNumber} data-level={verdict ?? undefined}>
          {formatScore(report.score)}
        </span>
        {report.score !== null && (
          <span className={styles.indexOf}>
            из 100{verdict && ` — ${QUALITY_LEVEL_LABELS[verdict].toLowerCase()}`}, {deviationText(report.score, true)}
          </span>
        )}
      </p>
      <p className={styles.conclusion}>{qualityConclusion(report)}</p>

      <p className={styles.chartNote} id="quality-bars-note">
        Справочники — от худшего к лучшему. Черта — цель {QUALITY_TARGET}, ниже {QUALITY_CRITICAL_BELOW} — критично.
      </p>
      <ul ref={listRef} className={styles.bars} data-inview={inView || undefined} aria-describedby="quality-bars-note">
        {entities.map((entity, index) => {
          const level = scoreLevel(entity.score)
          return (
            <li key={entity.entity} className={styles.bar} data-level={level ?? undefined} style={{ '--r': index } as CSSProperties}>
              <span className={styles.barName}>
                {entity.title}
                <span className={styles.barCount}>
                  {formatNumber(entity.total)} {pluralize(entity.total, RECORDS)}
                </span>
              </span>
              <span className={styles.track} aria-hidden>
                {entity.score !== null && <span className={styles.fill} style={{ width: `${entity.score}%` }} />}
                <span className={styles.target} style={{ left: `${QUALITY_TARGET}%` }} />
              </span>
              <span className={styles.barValue}>{formatScore(entity.score)}</span>
              <span className={styles.barDelta}>{deviationText(entity.score)}</span>
            </li>
          )
        })}
      </ul>

      <details className={styles.formula}>
        <summary>Как считается индекс</summary>
        <p>{report.explanation}</p>
        <p>
          Уровень проверки — по тому, сколько баллов она отнимает у оценки своего справочника: «критично» — от{' '}
          {CRITICAL_PENALTY} баллов, «требует внимания» — меньше. Уровень справочника и всего индекса: от {QUALITY_TARGET} — всё хорошо,
          от {QUALITY_CRITICAL_BELOW} — требует внимания, ниже — критично.
        </p>
      </details>
    </section>
  )
}

function IssueGroup({
  level,
  items,
  empty,
  canWrite,
  onDuplicates,
}: {
  level: Exclude<QualityLevel, 'ok'>
  items: LeveledIssue[]
  empty: string
  canWrite: boolean
  onDuplicates: (entity: DuplicateEntityType) => void
}) {
  // Первая строка группы «Критично» раскрыта сразу: какие записи и почему — видно без щелчка.
  const [choice, setChoice] = useState<string | null | undefined>(undefined)
  const openCode = choice === undefined ? (level === 'critical' ? (items[0]?.issue.code ?? null) : null) : choice

  return (
    <QueueGroup label={QUALITY_LEVEL_LABELS[level]} count={items.length}>
      {items.length === 0 ? (
        <li className={styles.none}>{empty}</li>
      ) : (
        items.map((item) => (
          <IssueRow
            key={item.issue.code}
            item={item}
            level={level}
            canWrite={canWrite}
            expanded={openCode === item.issue.code}
            onToggle={() => setChoice(openCode === item.issue.code ? null : item.issue.code)}
            onDuplicates={onDuplicates}
          />
        ))
      )}
    </QueueGroup>
  )
}

function IssueRow({
  item,
  level,
  canWrite,
  expanded,
  onToggle,
  onDuplicates,
}: {
  item: LeveledIssue
  level: Exclude<QualityLevel, 'ok'>
  canWrite: boolean
  expanded: boolean
  onToggle: () => void
  onDuplicates: (entity: DuplicateEntityType) => void
}) {
  const { issue } = item
  const action = issueAction(issue)
  // Эксперт (только чтение) исправить не может — для него это «Открыть».
  const linkLabel = action?.kind === 'link' && canWrite ? action.label : 'Открыть'
  const hidden = issue.count - Math.min(issue.items.length, ITEMS_SHOWN)
  const penalty = `−${formatPoints(issue.penalty)} ${pointsWord(issue.penalty)}`
  const count = `${formatNumber(issue.count)} из ${formatNumber(item.entityTotal)}`

  return (
    <QueueRow
      tone={LEVEL_TONE[level]}
      title={issue.title}
      // Вторая строка — зачем эта проверка (решение 212); справочник и баллы — хвостом.
      meta={{
        text: ISSUE_WHY[issue.code] ?? item.entityTitle,
        tail: `${item.entityTitle}, ${penalty}`,
        tailShort: penalty,
      }}
      value={{ text: count, tone: level === 'critical' ? 'danger' : 'muted' }}
      label={queueRowLabel([
        QUALITY_LEVEL_LABELS[level],
        issue.title,
        `${item.entityTitle}: нарушают ${count}`,
        penalty,
        expanded ? 'Свернуть записи' : 'Показать записи',
      ])}
      expanded={expanded}
      onToggle={onToggle}
      action={
        action?.kind === 'duplicates' ? (
          <Button
            variant="secondary"
            size="sm"
            icon="arrowRight"
            onClick={() => onDuplicates(action.entity)}
            aria-label={`Разобрать пары: ${issue.title}`}
          >
            Разобрать
          </Button>
        ) : action?.kind === 'link' ? (
          <Button
            variant="secondary"
            size="sm"
            icon="arrowRight"
            href={action.href}
            aria-label={`${linkLabel}: ${issue.items[0]?.name ?? issue.title}`}
          >
            {linkLabel}
          </Button>
        ) : undefined
      }
      detail={
        <div className={styles.detail}>
          <p className={styles.formulaLine}>
            Нарушают {count} ({share(issue.share)}). Вес проверки{' '}
            {formatPoints(issue.weight)} × доля {share(issue.share)} = {penalty} из 100 у справочника «{item.entityTitle}».
          </p>
          {issue.items.length > 0 && (
            <ul className={styles.records} aria-label={`Записи: ${issue.title}`}>
              {issue.items.slice(0, ITEMS_SHOWN).map((record) => (
                <li key={record.id}>
                  <Link className={styles.record} href={record.href}>
                    <Icon name="arrowRight" size={16} />
                    <span>{record.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <p className={styles.more}>
              и ещё {formatNumber(hidden)} {pluralize(hidden, RECORDS)}
            </p>
          )}
        </div>
      }
    />
  )
}

function Duplicates({
  counts,
  entity,
  onEntity,
  onChanged,
}: {
  counts: Record<DuplicateEntityType, number>
  entity: DuplicateEntityType | null
  onEntity: (entity: DuplicateEntityType) => void
  /** Пару разобрали — отчёт перечитывается: числа вкладок и проверки дублей сходятся со списком. */
  onChanged: () => void
}) {
  const withPairs = DUPLICATE_ENTITY_TYPES.filter((key) => counts[key] > 0)

  return (
    <div id={DUPLICATES_ANCHOR} className={styles.anchor}>
      <Section
        title="Кандидаты в дубли"
        description="Пары записей, похожих по названию, ИНН или словарю синонимов. Система только предлагает — решает человек. Вуз, которого нет в парах, администратор сливает из его карточки: «Слить с дублем»."
      >
        {withPairs.length === 0 ? (
          <EmptyState
            icon="check"
            title="Похожих записей нет"
            description="Ни в одном справочнике не найдено пар выше порога сходства. Слить два вуза вручную может администратор — в карточке вуза, кнопка «Слить с дублем»."
          />
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
                  onClick={() => onEntity(key)}
                >
                  {DUPLICATE_TITLES[key]} <span className={styles.dupCount}>{formatNumber(counts[key])}</span>
                </button>
              ))}
            </div>
            {entity && <DuplicatePairs key={entity} entity={entity} onChanged={onChanged} />}
          </>
        )}
      </Section>
    </div>
  )
}

function DuplicatePairs({ entity, onChanged }: { entity: DuplicateEntityType; onChanged: () => void }) {
  const user = useCurrentUser()
  const toast = useToast()
  const pairs = useResource<DuplicatePairDto[]>(`/api/data-quality/duplicates${buildQuery({ entity })}`)
  const dismiss = useMutation(async (pair: DuplicatePairDto) =>
    (await apiPost('/api/data-quality/duplicates/dismiss', { entity, firstId: pair.a.id, secondId: pair.b.id })).data,
  )
  const [merging, setMerging] = useState<DuplicatePairDto | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  // Слияние переносит связки, документы и учётные записи представителей —
  // необратимая по объёму операция, поэтому только ADMIN (решение 134).
  const canMerge = entity === 'university' && user.permissions.isAdmin

  async function onDismiss(pair: DuplicatePairDto, key: string) {
    setPendingKey(key)
    const result = await dismiss.run(pair)
    setPendingKey(null)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`«${pair.a.name}» и «${pair.b.name}» отмечены как разные записи`)
    pairs.reload()
    onChanged()
  }

  if (pairs.isLoading) return <TableSkeleton rows={3} columns={2} />
  if (pairs.error) return <ErrorState error={pairs.error} onRetry={pairs.reload} />
  const rows = pairs.data ?? []
  if (rows.length === 0) return <p className={styles.none}>Пар не осталось.</p>

  return (
    <>
      <Queue>
        <QueueGroup label={DUPLICATE_TITLES[entity]} count={rows.length}>
          {rows.map((pair) => {
            const key = `${pair.a.id}:${pair.b.id}`
            const similarity = `${Math.round(pair.score * 100)}%`
            const title = `${pair.a.name} и ${pair.b.name}`
            const dismissButton = (
              <Button
                variant={canMerge ? 'ghost' : 'secondary'}
                size="sm"
                icon="close"
                onClick={() => void onDismiss(pair, key)}
                isLoading={pendingKey === key}
                disabled={dismiss.isPending}
                aria-label={`Это разные записи: ${title}`}
              >
                Это разные записи
              </Button>
            )
            return (
              <QueueRow
                key={key}
                tone={pair.score >= 0.8 ? 'accent' : 'accent-soft'}
                title={title}
                meta={{ text: pair.reasons.join('; ') }}
                value={{ text: similarity, tone: 'accent' }}
                label={queueRowLabel([title, `сходство ${similarity}`, pair.reasons.join('; '), open === key ? 'Свернуть' : 'Показать пару'])}
                expanded={open === key}
                onToggle={() => setOpen(open === key ? null : key)}
                action={
                  canMerge ? (
                    <Button variant="secondary" size="sm" onClick={() => setMerging(pair)} aria-label={`Слить: ${title}`}>
                      Слить
                    </Button>
                  ) : user.permissions.canWrite ? (
                    dismissButton
                  ) : undefined
                }
                detail={
                  <div className={styles.detail}>
                    <ul className={styles.records} aria-label="Записи пары">
                      {[pair.a, pair.b].map((record) => (
                        <li key={record.id}>
                          <Link className={styles.record} href={record.href}>
                            <Icon name="arrowRight" size={16} />
                            <span>{record.name}</span>
                          </Link>
                          {record.hint && <span className={styles.hint}>{record.hint}</span>}
                        </li>
                      ))}
                    </ul>
                    <ul className={styles.reasons} aria-label="Почему похожи">
                      {pair.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    {canMerge && user.permissions.canWrite && <div className={styles.detailActions}>{dismissButton}</div>}
                  </div>
                }
              />
            )
          })}
        </QueueGroup>
      </Queue>
      {merging && <MergeUniversitiesModal pair={merging} onClose={() => setMerging(null)} onMerged={() => {
            pairs.reload()
            onChanged()
          }} />}
    </>
  )
}
