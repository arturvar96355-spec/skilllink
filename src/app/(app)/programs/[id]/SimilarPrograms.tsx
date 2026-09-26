'use client'

import Link from 'next/link'
import type { SimilarProgramsDto } from '@/shared/contracts'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  SkeletonLines,
  buildQuery,
  formatShare,
  programHref,
  useResource,
} from '@/ui'
import styles from './program.module.css'

/**
 * «Похожие программы» (решение 178, п. 5): косинус взвешенных векторов
 * навыков плюс бонусы за то же направление и уровень. Считается на лету,
 * снимок не хранится — запрашивается заново при каждом открытии карточки.
 */
export function SimilarPrograms({ programId }: { programId: string }) {
  const similar = useResource<SimilarProgramsDto>(
    `/api/programs/${programId}/similar${buildQuery({ limit: 5 })}`,
  )

  if (similar.isLoading) return <SkeletonLines count={3} />
  if (similar.error) return <ErrorState error={similar.error} onRetry={similar.reload} />
  const data = similar.data
  if (!data) return null

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon="program"
        title="Похожих программ нет"
        description="У программы нет общих навыков с другими — сходство считается только по ним."
      />
    )
  }

  return (
    <div className={styles.similarList}>
      {data.items.map((item) => (
        <Card key={item.program.id} className={styles.similarItem}>
          <div className={styles.similarHead}>
            <span className={styles.cellStack}>
              <Link className={[styles.cellTitle, styles.cellTitleLink].join(' ')} href={programHref(item.program.id)}>
                {item.program.name}
              </Link>
              <span className={styles.cellMeta}>{item.program.universityName}</span>
            </span>
            <span className={styles.similarScore}>{formatShare(item.score)} сходства</span>
          </div>

          <div className={styles.similarBadges}>
            {item.sameDirection && <Badge tone="neutral">то же направление</Badge>}
            {item.sameLevel && <Badge tone="neutral">тот же уровень</Badge>}
          </div>

          {item.missingSkills.length > 0 && (
            <p className={styles.similarSkills}>
              Чего нет у этой программы: {item.missingSkills.map((skill) => skill.name).join(', ')}
            </p>
          )}
        </Card>
      ))}
      <p className={styles.note}>{data.explanation}</p>
    </div>
  )
}
