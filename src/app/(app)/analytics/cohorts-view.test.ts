import { describe, expect, it } from 'vitest'
import type { CohortDto } from '@/shared/contracts'
import {
  SMALL_COHORT,
  bestAt,
  cellHeat,
  cohortGenitive,
  cohortLabel,
  cohortsBase,
  cohortsConclusion,
  comparableAt,
  comparisonRows,
  defaultHorizon,
  deviationText,
  halfReachedAt,
  halfText,
  ladderWidth,
  pooled,
  speedConclusion,
} from './cohorts-view'

/** Когорта: доли по кварталам работы; последний квартал — идущий (`complete: false`). */
function cohort(key: string, size: number, reached: number[]): CohortDto {
  return {
    cohort: key,
    size,
    cells: reached.map((count, offset) => ({
      offset,
      reached: count,
      share: size > 0 ? Math.round((count / size) * 10000) / 10000 : null,
      complete: offset < reached.length - 1,
    })),
  }
}

/** Ответ сервера на демо-базе (27.09.2026): четыре квартала, самая старая когорта — малая. */
const SEED: CohortDto[] = [
  cohort('2025-Q3', 2, [0, 2, 2, 2, 2]),
  cohort('2026-Q1', 9, [2, 9, 9]),
  cohort('2026-Q2', 34, [5, 21]),
  cohort('2026-Q3', 33, [8]),
]

describe('когорты: подписи', () => {
  it('квартал словами — как период в остальной аналитике', () => {
    expect(cohortLabel('2026-Q1')).toBe('1-й квартал 2026')
    expect(cohortGenitive('2025-Q3')).toBe('3-го квартала 2025')
    expect(cohortGenitive('нечто')).toBe('нечто')
  })

  it('половина когорты — во 2-м, но в 1-м и 3-м квартале', () => {
    expect(halfText(SEED[1]!)).toBe('во 2-м кв.')
    expect(halfText(cohort('2026-Q2', 10, [6, 8]))).toBe('в 1-м кв.')
    expect(halfText(cohort('2026-Q2', 10, [1, 2, 7]))).toBe('в 3-м кв.')
    expect(halfText(SEED[3]!)).toBe('ещё нет')
  })
})

describe('когорты: пустой ответ', () => {
  it('нет когорт — вывод говорит об этом, срок по умолчанию — квартал старта', () => {
    expect(cohortsConclusion([], 0)).toBe('Связок пока нет — когорты появятся, когда начнётся работа хотя бы по одной.')
    expect(speedConclusion([])).toBe('Когорт пока нет.')
    expect(defaultHorizon([])).toBe(0)
    expect(ladderWidth([])).toBe(0)
    expect(comparisonRows([], 0)).toEqual([])
  })

  it('когорта без связок — доля «нет данных», а не ноль', () => {
    const empty: CohortDto = { cohort: '2026-Q1', size: 0, cells: [{ offset: 0, reached: 0, share: null, complete: true }] }
    expect(pooled([empty], 0).share).toBeNull()
    expect(cellHeat(empty, empty.cells[0]!)).toBe(0)
    expect(comparisonRows([empty], 0)[0]!.value).toBeNull()
  })
})

describe('когорты: малые когорты', () => {
  it(`меньше ${SMALL_COHORT} связок — не сравнивается и не бывает лучшей`, () => {
    // Малая когорта подписала 100 % — всё равно не «лучшая».
    const list = [cohort('2025-Q4', 2, [2, 2]), cohort('2026-Q1', 10, [3, 5]), cohort('2026-Q2', 20, [4, 6])]
    expect(comparableAt(list, 0).map((item) => item.cohort)).toEqual(['2026-Q1', '2026-Q2'])
    expect(bestAt(list, 0)?.cohort).toBe('2026-Q1')
    expect(cohortsConclusion(list, 0)).not.toContain('4-го квартала 2025')
  })

  it('малая когорта в полосах приглушена и подписана «мало данных», без цвета в лестнице', () => {
    const rows = comparisonRows(SEED, 0)
    const small = rows.find((row) => row.key === '2025-Q3')!
    expect(small.tone).toBe('muted')
    expect(small.note).toBe(`мало данных — меньше ${SMALL_COHORT} связок`)
    expect(cellHeat(SEED[0]!, SEED[0]!.cells[1]!)).toBe(0)
    expect(cellHeat(SEED[1]!, SEED[1]!.cells[1]!)).toBe(100)
  })

  it('все когорты малые — сравнивать не на чем, скорость не оценить', () => {
    const list = [cohort('2026-Q1', 3, [1, 2]), cohort('2026-Q2', 4, [1])]
    expect(cohortsConclusion(list, 0)).toBe(
      `Сравнивать к концу 1-го квартала работы пока не на чем: в когортах меньше ${SMALL_COHORT} связок или квартал ещё идёт.`,
    )
    expect(speedConclusion(list)).toBe(`Во всех когортах меньше ${SMALL_COHORT} связок — скорость по ним не оценить.`)
  })

  it('база подсчёта называет малые когорты', () => {
    expect(cohortsBase(SEED)).toBe(
      '78 связок в 4 когортах; 1 когорта меньше 5 связок — «мало данных», в сравнении не участвуют.',
    )
    expect(cohortsBase([cohort('2026-Q1', 21, [1])])).toBe('21 связка в 1 когорте.')
  })
})

describe('когорты: срок сравнения и вывод одной фразой', () => {
  it('идущий квартал — «пока»: в сравнение не входит', () => {
    // 2026-Q2 на 2-м квартале — идущий: сравнима только 2026-Q1.
    expect(comparableAt(SEED, 1).map((item) => item.cohort)).toEqual(['2026-Q1'])
    const rows = comparisonRows(SEED, 1)
    expect(rows.find((row) => row.key === '2026-Q2')!.note).toBe('квартал ещё идёт — это «пока»')
  })

  it('срок по умолчанию — самый дальний, где сравнимы хотя бы две когорты', () => {
    expect(defaultHorizon(SEED)).toBe(0)
    const older = [cohort('2025-Q1', 10, [1, 4, 6, 6]), cohort('2025-Q2', 10, [2, 5, 7]), cohort('2025-Q3', 10, [3, 5])]
    expect(defaultHorizon(older)).toBe(1)
  })

  it('на демо-базе: лучшая когорта против остальных вместе', () => {
    expect(cohortsConclusion(SEED, 0)).toBe(
      'Когорта 1-го квартала 2026 быстрее всех дошла до договора: к концу 1-го квартала работы подписали 22% (2 из 9) против 15% у остальных.',
    )
  })

  it('одна сравнимая когорта — сравнивать не с чем, но число названо', () => {
    expect(cohortsConclusion(SEED, 1)).toBe(
      'Сравнивать к концу 2-го квартала работы пока не с чем: закончился он только у когорты 1-го квартала 2026 — договор подписали 100% (9 из 9).',
    )
  })

  it('равные доли — «вровень», без выдуманного лидера', () => {
    const list = [cohort('2026-Q1', 10, [3, 3]), cohort('2026-Q2', 20, [6, 6])]
    expect(cohortsConclusion(list, 0)).toBe(
      'Когорты идут вровень: к концу 1-го квартала работы договор подписали 30% связок (9 из 30) в 2 когортах.',
    )
  })

  it('отклонение от остальных — словами, в пунктах целых процентов', () => {
    expect(deviationText(0.2222, 0.1471)).toBe('на 7 пунктов выше остальных')
    expect(deviationText(0.1, 0.12)).toBe('на 2 пункта ниже остальных')
    expect(deviationText(0.3, 0.3)).toBe('на уровне остальных')
    expect(deviationText(null, 0.3)).toBeUndefined()
  })

  it('полосы: у каждой когорты «из N», отклонение — те же числа, что во фразе', () => {
    const rows = comparisonRows(SEED, 0)
    expect(rows.map((row) => row.key)).toEqual(['2025-Q3', '2026-Q1', '2026-Q2', '2026-Q3'])
    expect(rows[1]!.valueText).toBe('22% · 2 из 9')
    // Фраза: «22% (2 из 9) против 15% у остальных» — и полоса говорит «на 7 пунктов выше».
    expect(rows[1]!.note).toBe('на 7 пунктов выше остальных')
    expect(rows[2]!.note).toBe('на 7 пунктов ниже остальных')
    expect(rows[3]!.tone).toBe('muted')
  })

  it('единственная сравнимая когорта — «сравнить пока не с чем»', () => {
    const row = comparisonRows(SEED, 1).find((item) => item.key === '2026-Q1')!
    expect(row.note).toBe('сравнить пока не с чем')
    expect(row.noteTone).toBe('muted')
  })
})

describe('когорты: как быстро — медиана в кварталах', () => {
  it('половина, набранная в идущем квартале, уже окончательна', () => {
    expect(halfReachedAt(SEED[2]!)).toBe(1)
    expect(halfReachedAt(SEED[3]!)).toBeNull()
  })

  it('на демо-базе: обычно во 2-м квартале, у молодой когорты — пока нет', () => {
    expect(speedConclusion(SEED)).toBe(
      'Половина когорты обычно подписывает договор во 2-м квартале работы — так в 2 когортах из 3; в когорте 3-го квартала 2026 половина пока не подписала.',
    )
  })

  it('ни у кого половины нет — так и сказано', () => {
    expect(speedConclusion([cohort('2026-Q2', 10, [1, 2])])).toBe(
      'Ни в одной когорте половина связок ещё не подписала договор.',
    )
  })
})
