import { describe, expect, it } from 'vitest'
import type { CooperationListItemDto, StagePhase } from '@/shared/contracts'
import { phaseFunnel } from './phase-funnel'

function at(phase: StagePhase | null): CooperationListItemDto {
  return {
    currentStage: phase ? { phase } : null,
  } as unknown as CooperationListItemDto
}

describe('воронка связок по фазам', () => {
  it('связка дошла до всех фаз не позже своей текущей', () => {
    const steps = phaseFunnel([at('ATTRACTION'), at('IMPLEMENTATION'), at('IMPLEMENTATION'), at(null)])
    expect(steps.map((step) => step.value)).toEqual([4, 3, 3, 1, 1])
  })

  it('пустой список — нули, а не пропуск шагов', () => {
    expect(phaseFunnel([]).map((step) => step.value)).toEqual([0, 0, 0, 0, 0])
  })

  it('воронка не расширяется', () => {
    const values = phaseFunnel([at('OPERATION'), at('FORMALIZATION'), at(null)]).map((step) => step.value)
    values.slice(1).forEach((value, index) => expect(value).toBeLessThanOrEqual(values[index]!))
  })
})
