import type { QualityEntityReportDto, QualityIssueDto, QualityReportDto } from '@/shared/contracts'

/**
 * Раскладка отчёта качества данных по уровням (ТЗ дизайна 26–29.09, п. 4.4):
 * «Критично → Требует внимания → Всё хорошо». Без React — проверяется тестом.
 *
 * Уровень проблемы — по тому, сколько баллов она отнимает у оценки своей сущности
 * (`penalty` из формулы сервера, решение 134), а не по ощущению: так уровень
 * объясним одной фразой и совпадает с тем, что двигает общую оценку.
 */

/** Отнимает не меньше стольких баллов — «критично». TEMP: порог показа, согласовать с Артуром. */
export const CRITICAL_PENALTY = 10 // TEMP

export type QualityLevel = 'critical' | 'attention' | 'ok'

export const QUALITY_LEVEL_LABELS: Record<QualityLevel, string> = {
  critical: 'Критично',
  attention: 'Требует внимания',
  ok: 'Всё хорошо',
}

export interface LeveledIssue {
  entity: QualityEntityReportDto['entity']
  entityTitle: string
  entityTotal: number
  issue: QualityIssueDto
}

export function issueLevel(issue: QualityIssueDto): QualityLevel {
  if (issue.count === 0) return 'ok'
  return issue.penalty >= CRITICAL_PENALTY ? 'critical' : 'attention'
}

/** Проблемы по уровням; внутри уровня — сначала те, что отнимают больше баллов. */
export function groupIssues(report: QualityReportDto): Record<QualityLevel, LeveledIssue[]> {
  const groups: Record<QualityLevel, LeveledIssue[]> = { critical: [], attention: [], ok: [] }
  for (const entity of report.entities) {
    for (const issue of entity.issues) {
      groups[issueLevel(issue)].push({
        entity: entity.entity,
        entityTitle: entity.title,
        entityTotal: entity.total,
        issue,
      })
    }
  }
  for (const level of ['critical', 'attention'] as const) {
    groups[level].sort((a, b) => b.issue.penalty - a.issue.penalty)
  }
  return groups
}

/** Общий вердикт по оценке 0–100 — те же пороги, что у плиток сущностей. */
export function scoreLevel(score: number | null): QualityLevel | null {
  if (score === null) return null
  if (score >= 90) return 'ok'
  if (score >= 75) return 'attention'
  return 'critical'
}
