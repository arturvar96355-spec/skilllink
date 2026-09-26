'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  RECOMMENDATION_STATUS_LABELS,
  type RecommendationDto,
  type RecommendationTargetDto,
  type WhyNotCheckDto,
  type WhyNotDto,
  type WhyNotEntity,
} from '@/shared/contracts'
import { Button, ErrorState, Icon, SkeletonLines, buildQuery, formatDateTime, pluralize, recommendationHref, useResource } from '@/ui'
import styles from './RuleChecks.module.css'

/**
 * Объяснимость рекомендаций (ТЗ дизайна 26–29.09, п. 4.1): «почему система это
 * рекомендует» и «почему нет». Оба ответа — из `GET /api/recommendations/why-not`:
 * это те же проверки, что правило делает при пересборке (решение 119), а не
 * пересказ балла. У открытой рекомендации все проверки её правила пройдены —
 * их и показываем как «почему»; у объекта без рекомендации видно, какая
 * проверка не прошла.
 */

/** Вид объекта для why-not; по вузу правил нет — там объяснять нечего. */
export function whyNotEntityOf(target: RecommendationTargetDto): WhyNotEntity | null {
  switch (target.objectType) {
    case 'Cooperation':
      return 'cooperation'
    case 'EducationalProgram':
      return 'program'
    case 'Skill':
      return 'skill'
    default:
      return null
  }
}

function whyNotPath(entity: WhyNotEntity, id: string, rule?: string): string {
  return `/api/recommendations/why-not${buildQuery({ entity, id, rule })}`
}

function CheckList({ checks }: { checks: WhyNotCheckDto[] }) {
  return (
    <ul className={styles.checks}>
      {checks.map((check) => (
        <li key={`${check.ruleKey}:${check.check}`} className={styles.check} data-pass={check.pass ? 'yes' : 'no'}>
          <span className={styles.mark} aria-hidden>
            <Icon name={check.pass ? 'check' : 'close'} size={16} />
          </span>
          <span className={styles.checkText}>
            <span className={styles.checkLabel}>
              <span className="visually-hidden">{check.pass ? 'Выполнено: ' : 'Не выполнено: '}</span>
              {check.label}
            </span>
            <span className={styles.checkDetail}>{check.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** «Почему система это рекомендует» — проверки правила этой рекомендации. */
export function WhyRecommended({ recommendation }: { recommendation: RecommendationDto }) {
  const entity = whyNotEntityOf(recommendation.target)
  const why = useResource<WhyNotDto>(
    entity ? whyNotPath(entity, recommendation.target.objectId, recommendation.ruleKey) : null,
  )
  if (!entity) return null
  if (why.isLoading) return <SkeletonLines count={3} />
  if (why.error) return <ErrorState error={why.error} onRetry={why.reload} />
  const rule = why.data?.rules[0]
  if (!rule) return null

  return (
    <div className={styles.root}>
      <p className={styles.lead}>
        {rule.wouldRecommend
          ? `Правило «${rule.ruleLabel}» проверяет ${rule.checks.length} ${pluralize(rule.checks.length, ['условие', 'условия', 'условий'])} — сейчас выполнены все.`
          : `Правило «${rule.ruleLabel}» сейчас выдало бы другой ответ: часть условий уже не выполняется — рекомендация могла устареть.`}
      </p>
      <CheckList checks={rule.checks} />
      {why.data && <p className={styles.meta}>Проверено {formatDateTime(why.data.checkedAt)}</p>}
    </div>
  )
}

/**
 * «Почему нет рекомендации» по объекту — раскрывается по нажатию: проверок
 * по всем правилам много, и сразу они не нужны.
 */
export function WhyNoRecommendation({ entity, id }: { entity: WhyNotEntity; id: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const why = useResource<WhyNotDto>(isOpen ? whyNotPath(entity, id) : null)

  if (!isOpen) {
    return (
      <Button variant="secondary" size="sm" icon="info" onClick={() => setIsOpen(true)}>
        Почему нет рекомендации?
      </Button>
    )
  }
  if (why.isLoading) return <SkeletonLines count={3} />
  if (why.error) return <ErrorState error={why.error} onRetry={why.reload} />
  if (!why.data) return null

  return (
    <div className={styles.root}>
      <p className={styles.lead}>
        Система проверяет каждое правило по этому объекту теми же условиями, что при пересборке. Рекомендация
        появляется, только когда выполнены все условия правила.
      </p>
      {why.data.rules.map((rule) => {
        const failed = rule.checks.filter((check) => !check.pass)
        return (
          <section key={rule.ruleKey} className={styles.rule}>
            <header className={styles.ruleHead}>
              <h3 className={styles.ruleTitle}>{rule.ruleLabel}</h3>
              {rule.recommendation ? (
                <Link className={styles.ruleLink} href={recommendationHref(rule.recommendation.id)}>
                  Рекомендация есть · {RECOMMENDATION_STATUS_LABELS[rule.recommendation.status].toLowerCase()}
                  <Icon name="arrowRight" size={16} />
                </Link>
              ) : (
                <span className={styles.ruleVerdict} data-pass={rule.wouldRecommend ? 'yes' : 'no'}>
                  {rule.wouldRecommend
                    ? 'Условия выполнены — появится при следующей пересборке'
                    : `Не выполнено условий: ${failed.length}`}
                </span>
              )}
            </header>
            {/* Сначала — то, что не прошло: ради этого сюда и пришли. */}
            <CheckList checks={[...failed, ...rule.checks.filter((check) => check.pass)]} />
          </section>
        )
      })}
      <p className={styles.meta}>Проверено {formatDateTime(why.data.checkedAt)}</p>
    </div>
  )
}
