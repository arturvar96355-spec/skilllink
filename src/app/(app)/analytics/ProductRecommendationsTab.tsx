'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ProductRecommendationDto, ProductRecommendationsDto } from '@/shared/contracts'
import {
  Button,
  Card,
  CardsSkeleton,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  MeasureBars,
  MockBadge,
  Progress,
  Section,
  Select,
  Toolbar,
  ToolbarItem,
  buildQuery,
  formatNumber,
  programHref,
  useResource,
  type Column,
} from '@/ui'
import { showAllState } from '@/ui/lib/show-all'
import { ProductOfferLetterModal } from '../ProductOffers'
import { CONFIDENCE_WORDS, reachMax, reachRows } from '../product-offers-view'
import styles from './analytics.module.css'

const PAGE = 20

/**
 * Вкладка «Рекомендации продуктов» (решение 223): какой IT-продукт куда нести по
 * всему портфелю. Вверху — для скольких программ каждый продукт лучший вариант,
 * ниже — у каждого продукта его самые сильные программы или, если выбран продукт,
 * все программы, которым он рекомендуется. Действия (письмо, связка) — в карточке программы;
 * здесь только «Черновик письма», чтобы не уходить со списка.
 */
export function ProductRecommendationsTab() {
  const [productId, setProductId] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [letterFor, setLetterFor] = useState<ProductRecommendationDto | null>(null)

  const resource = useResource<ProductRecommendationsDto>(
    `/api/analytics/product-recommendations${buildQuery({ limit, productId: productId || undefined })}`,
    { keepPreviousData: true },
  )
  /**
   * Последний успешный ответ и продукт, к которому он относится (ревью Codex 18).
   * Пока идёт или упал запрос по новому продукту, на экране остаются прежние
   * строки — и подписываются прежним продуктом, а не выбранным в поле: заголовок
   * не должен обещать то, чего на экране нет. Ошибка нового запроса видна всегда.
   */
  const [shown, setShown] = useState<{ data: ProductRecommendationsDto; productId: string } | null>(null)
  useEffect(() => {
    if (resource.data && !resource.isLoading && !resource.isRefreshing && !resource.error) {
      setShown({ data: resource.data, productId })
    }
    // productId — ключ того запроса, чей ответ пришёл: адрес строится из него.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.data, resource.isLoading, resource.isRefreshing, resource.error])
  // До первого успешного ответа — сам ответ: подписывать пока нечего, а пустого кадра не будет.
  const data = shown?.data ?? resource.data
  const shownProductId = shown ? shown.productId : productId
  const reach = data?.reach ?? []
  const productName = reach.find((row) => row.productId === shownProductId)?.productName

  const columns: Column<ProductRecommendationDto>[] = [
    {
      key: 'program',
      title: 'Программа',
      render: (row) => (
        <span className={styles.skillCell}>
          <Link className={styles.rowTitle} href={programHref(row.program.id)}>
            {row.program.name}
          </Link>
          <span className={styles.muted}>{row.program.universityName}</span>
        </span>
      ),
    },
    {
      key: 'product',
      title: 'Что предложить',
      render: (row) => (
        <span className={styles.skillCell}>
          <span className={styles.rowTitle}>{row.product.name}</span>
          {row.bestForProgram && <span className={styles.muted}>лучший для этой программы</span>}
        </span>
      ),
    },
    {
      key: 'score',
      title: 'Балл',
      width: '170px',
      render: (row) => (
        <span className={styles.measure}>
          <span className={styles.measureValue}>{row.score} из 100</span>
          <Progress value={row.score} label={`Балл рекомендации: ${row.score} из 100`} />
        </span>
      ),
    },
    {
      key: 'closes',
      title: 'Закроет',
      wide: true,
      render: (row) => (
        <span className={styles.muted}>
          {row.closes
            .slice(0, 3)
            .map((skill) => `${skill.name} (${skill.demand})`)
            .join(', ')}
          {row.closes.length > 3 ? ` и ещё ${row.closes.length - 3}` : ''}
        </span>
      ),
    },
    {
      key: 'confidence',
      title: 'Данные',
      width: '150px',
      render: (row) => <span className={styles.muted}>{CONFIDENCE_WORDS[row.confidence]}</span>,
    },
  ]
  if (data?.actions.canDraftLetter) {
    columns.push({
      key: 'actions',
      title: '',
      width: '170px',
      render: (row) => (
        <Button size="sm" variant="ghost" icon="mail" onClick={() => setLetterFor(row)}>
          Черновик письма
        </Button>
      ),
    })
  }

  if (resource.isLoading && !data) return <CardsSkeleton count={2} />
  if (resource.error && !data) return <ErrorState error={resource.error} onRetry={resource.reload} />
  if (!data) return null

  const chart = reachRows(reach)
  const showAll = showAllState(data.items.length, data.total, limit, 100)

  return (
    <>
      <Section
        title="Какой продукт куда нести"
        help={{
          topic: 'product-recommendations',
          section: 'portfolio',
          note: 'Полоса — для скольких действующих программ продукт лучший вариант по баллу. Рядом — скольким программам он рекомендуется вообще (балл не ниже 10) и средний балл. Балл пары — насколько продукт закрывает дефициты навыков программы: спрос рынка минус покрытие программой по каждому навыку продукта, в среднем, с весом значимости навыка.',
        }}
        description={
          data.programCount === undefined
            ? data.summary
            : `${shownProductId ? '' : `${data.summary} `}Рассмотрено ${formatNumber(data.programCount)} действующих программ, период спроса ${data.period ?? '—'}.`
        }
        action={data.isMock ? <MockBadge title="Спрос рынка — демонстрационный набор: баллы учебные." /> : undefined}
      >
        {chart.length === 0 ? (
          <Card muted>
            <EmptyState icon="product" title="Рекомендаций нет" description={data.summary} />
          </Card>
        ) : (
          <Card>
            <MeasureBars
              download={{ title: 'Какой продукт куда нести', note: 'Для скольких программ каждый продукт — лучший вариант' }}
              rows={chart}
              max={reachMax(reach)}
              label="Для скольких программ каждый продукт — лучший вариант"
              valueWidth="8.5rem"
              rest={
                data.productsWithoutSkills.length > 0
                  ? `Не сравнивались — у продуктов не записаны навыки: ${data.productsWithoutSkills.join(', ')}`
                  : undefined
              }
            />
          </Card>
        )}
      </Section>

      <Section
        title={productName ? `Куда нести «${productName}»` : 'Где каждый продукт нужнее всего'}
        description={
          shownProductId
            ? data.summary
            : 'У каждого продукта — три программы, где он закрывает больше всего, от сильной рекомендации к слабой. Все программы продукта — в поле «Продукт». Название программы открывает её карточку: там причины, «Черновик письма» и «Создать связку».'
        }
      >
        <Toolbar>
          <ToolbarItem>
            <Select
              label="Продукт"
              placeholder="Все продукты — по три сильнейшие программы"
              value={productId}
              onValueChange={(value) => {
                setProductId(value)
                setLimit(PAGE)
              }}
              options={reach
                .filter((row) => row.recommendedFor > 0)
                .map((row) => ({ value: row.productId, label: row.productName }))}
            />
          </ToolbarItem>
          <ToolbarItem>
            <span className={styles.muted}>
              Как считается балл <InfoHint text={data.method} />
            </span>
          </ToolbarItem>
        </Toolbar>

        {resource.error ? (
          // Новый запрос упал — ошибкой, а не прежним списком под новым выбором.
          <ErrorState error={resource.error} onRetry={resource.reload} />
        ) : (
          <Card padding="none">
            {data.items.length === 0 ? (
              <EmptyState icon="product" title="Пар нет" description={data.summary} />
            ) : (
              <DataTable
                rows={data.items}
                columns={columns}
                getRowKey={(row) => `${row.program.id}:${row.product.id}`}
                isRefreshing={resource.isRefreshing}
                caption="Рекомендации продуктов по программам"
                narrow="stack"
              />
            )}
          </Card>
        )}

        {!resource.error && showAll && (
          <p className={styles.tail}>
            {showAll.note}
            {showAll.action && (
              <>
                {' '}
                <Button variant="ghost" size="sm" onClick={() => setLimit(100)}>
                  {showAll.action}
                </Button>
              </>
            )}
          </p>
        )}
      </Section>

      {letterFor && <ProductOfferLetterModal item={letterFor} onClose={() => setLetterFor(null)} />}
    </>
  )
}
