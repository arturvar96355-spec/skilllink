import { describe, expect, it } from 'vitest'
import type { CooperationCountsDto, StageWithCooperationDto } from '@/shared/contracts'
import {
  activeBreakdown,
  funnelComposition,
  mergeProblemStages,
  metricValueText,
  problemDetail,
  problemReason,
  problemSummary,
  reportDocumentTitle,
  criticalGapsLabel,
  skillCoverageCount,
  sourceLine,
  trendText,
  universityShortNames,
} from './report'

function counts(patch: Partial<CooperationCountsDto> = {}): CooperationCountsDto {
  return { active: 7, inWork: 6, drafts: 1, paused: 0, completed: 1, total: 8, ...patch }
}

function stage(patch: Partial<StageWithCooperationDto> & { id: string }): StageWithCooperationDto {
  return {
    cooperationId: 'coop-1',
    stageNumber: 6,
    title: 'Подписание документов',
    status: 'IN_PROGRESS',
    deadline: '2026-07-30T11:00:00.000Z',
    isOverdue: true,
    daysToDeadline: -57,
    blockingReason: null,
    universityName: 'Санкт-Петербургский государственный университет телекоммуникаций',
    programName: 'Программная инженерия',
    productName: null,
    ...patch,
  } as StageWithCooperationDto
}

describe('показатели отчёта', () => {
  it('единица — по числу, доля — с одним знаком, как на главной', () => {
    expect(metricValueText({ key: 'activeCooperations', value: 7, unit: 'связей' })).toBe('7 связей')
    expect(metricValueText({ key: 'universitiesInWork', value: 4, unit: 'вузов' })).toBe('4 вуза')
    expect(metricValueText({ key: 'avgDaysToClasses', value: 181, unit: 'дней' })).toBe('181 день')
    expect(metricValueText({ key: 'stagesOnTimePercent', value: 89.13, unit: '%' })).toBe('89,1%')
  })

  it('нет данных — «Нет данных», а не ноль', () => {
    expect(metricValueText({ key: 'avgDaysToClasses', value: null, unit: 'дней' })).toBe('Нет данных')
  })

  it('сравнение за период: знак, пункты у долей, ноль без слов', () => {
    expect(trendText({ previous: 6, delta: 1, direction: 'up', periodLabel: 'за 30 дней' }, false)).toBe('+1 за 30 дней')
    expect(trendText({ previous: 90, delta: -2.46, direction: 'down', periodLabel: 'за 30 дней' }, true)).toBe(
      '−2,5 п.п. за 30 дней',
    )
    expect(trendText({ previous: 7, delta: 0, direction: 'flat', periodLabel: 'за 30 дней' }, false)).toBe('0 за 30 дней')
  })
})

describe('связки', () => {
  it('разбивка активных — как в шапке главной', () => {
    expect(activeBreakdown(counts())).toBe('7 активных: 6 в работе, 1 черновик')
    expect(activeBreakdown(counts({ active: 3, inWork: 3, drafts: 0 }))).toBe('3 активные: 3 в работе')
    expect(activeBreakdown(counts({ active: 0, inWork: 0, drafts: 0 }))).toBe('Активных связок нет')
  })

  it('воронка — всего, активные, на паузе только если есть, завершённые', () => {
    expect(funnelComposition(counts())).toBe('В воронке 8 связок: 7 активных, 1 завершённая')
    expect(funnelComposition(counts({ paused: 2, total: 10, completed: 1 }))).toBe(
      'В воронке 10 связок: 7 активных, 2 на паузе, 1 завершённая',
    )
  })
})

describe('проблемные этапы', () => {
  it('этап из обоих списков — одна строка с причиной «заблокирован»', () => {
    const both = stage({
      id: 's-2',
      status: 'BLOCKED',
      blockingReason: 'Ждём юристов',
      deadline: '2026-09-13T09:00:00.000Z',
      daysToDeadline: -12,
    })
    const rows = mergeProblemStages([stage({ id: 's-1' }), both], [both])
    expect(rows.map((row) => row.key)).toEqual(['s-1', 's-2'])
    expect(problemReason(rows[1]!)).toBe('заблокирован')
    expect(problemDetail(rows[1]!)).toBe('Ждём юристов · срок вышел 12 дн. назад')
  })

  it('порядок — по сроку, самые давние сверху, без срока — в конце', () => {
    const rows = mergeProblemStages(
      [stage({ id: 'b', deadline: '2026-09-01T00:00:00.000Z' }), stage({ id: 'a', deadline: '2026-08-01T00:00:00.000Z' })],
      [stage({ id: 'c', status: 'BLOCKED', deadline: null, daysToDeadline: null, isOverdue: false })],
    )
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
    expect(rows[2]!.daysOverdue).toBeNull()
  })

  it('причина: дни просрочки или «срок вышел сегодня»', () => {
    const [late] = mergeProblemStages([stage({ id: 's-1' })], [])
    expect(problemReason(late!)).toBe('просрочен на 57 дн.')
    expect(problemReason({ isBlocked: false, daysOverdue: 0 })).toBe('срок вышел сегодня')
  })

  it('заблокированный без срока и без причины — без пояснения', () => {
    const [row] = mergeProblemStages([], [stage({ id: 's', status: 'BLOCKED', deadline: null, daysToDeadline: null, isOverdue: false })])
    expect(problemDetail(row!)).toBeNull()
  })

  it('подпись считает этапы и разделяет просрочку и блокировку', () => {
    const rows = mergeProblemStages(
      [stage({ id: '1' }), stage({ id: '2' }), stage({ id: '3' })],
      [stage({ id: '4', status: 'BLOCKED' })],
    )
    expect(problemSummary(rows)).toBe('4 этапа: 3 просрочены, 1 заблокирован.')
    expect(problemSummary([])).toBe('Просроченных и заблокированных этапов нет.')
  })
})

describe('краткие названия вузов', () => {
  it('берутся из сводки; без краткого — полное остаётся', () => {
    const names = universityShortNames({
      problemCooperations: [
        { universityName: 'Московский технический университет связи и информатики', universityShortName: 'МТУСИ' },
        { universityName: 'Вуз без краткого названия', universityShortName: null },
      ],
      topPrograms: [{ universityName: 'Новосибирский государственный технический университет', universityShortName: 'НГТУ' }],
    } as never)
    expect(names.get('Московский технический университет связи и информатики')).toBe('МТУСИ')
    expect(names.get('Новосибирский государственный технический университет')).toBe('НГТУ')
    expect(names.has('Вуз без краткого названия')).toBe(false)
  })
})

describe('навыки и заголовок', () => {
  it('покрытие навыков — «16 из 18»; нет рынка — «Нет данных», а не ноль', () => {
    const base = { coveragePercent: 88.9, criticalGaps: 2, period: '2026-Q1', isMock: true }
    expect(skillCoverageCount({ ...base, coveredSkills: 16, demandedSkills: 18 })).toBe('16 из 18')
    expect(skillCoverageCount({ ...base, coveredSkills: 0, demandedSkills: 18 })).toBe('0 из 18')
    expect(skillCoverageCount({ ...base, coveredSkills: null, demandedSkills: null })).toBe('Нет данных')
  })

  it('подпись критических дефицитов — по числу', () => {
    expect(criticalGapsLabel(1)).toBe('критический дефицит')
    expect(criticalGapsLabel(2)).toBe('критических дефицита')
    expect(criticalGapsLabel(5)).toBe('критических дефицитов')
    expect(criticalGapsLabel(null)).toBe('критических дефицитов')
  })

  it('заголовок — имя файла PDF: дата по Москве, без двоеточий', () => {
    // 22:30 UTC 24.09 — в Москве уже 25.09.
    const title = reportDocumentTitle('2026-09-24T22:30:00.000Z')
    expect(title).toBe('Отчёт руководителю SkillLink 25.09.2026')
    expect(title).not.toContain(':')
  })
})

describe('строка об источнике', () => {
  const skillMatch = { coveragePercent: 88.9, coveredSkills: 16, demandedSkills: 18, criticalGaps: 2, period: '2026-Q1', isMock: true }

  it('называет период спроса и прямо говорит о демонстрационных данных', () => {
    const line = sourceLine({ skillMatch, containsMockData: true })
    expect(line).toContain('за период 2026-Q1')
    expect(line).toContain('демонстрационная')
  })

  it('без демо-данных пометки нет', () => {
    expect(sourceLine({ skillMatch, containsMockData: false })).not.toContain('демонстрационн')
  })
})
