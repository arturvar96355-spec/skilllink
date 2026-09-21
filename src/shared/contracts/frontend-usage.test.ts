import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  COOPERATION_STATUS_LABELS,
  PROGRAM_LEVEL_LABELS,
  STAGE_STATUS_LABELS,
  USER_ROLE_LABELS,
} from './labels'
import type { PortalProgramDto } from './portal'
import type { UserRefDto, WorkflowStageDto } from './workflow'
import type { CooperationDto } from './cooperation'
import type { RankedProgramDto, UniversityRatingDto } from './rating'
import type { UniversityListItemDto } from './university'

/**
 * Здесь проверяется не логика, а то, что код из docs/TASK_FRONTEND.md
 * вообще компилируется.
 *
 * Поля перечислений, объявленные как `string`, выглядят безобидно — пока фронт
 * не напишет `USER_ROLE_LABELS[ref.role]` и не упрётся в ошибку типов на первом
 * же экране. Так было с ролью в истории этапа и с уровнем программы в кабинете вуза.
 */
describe('примеры из задания фронту компилируются', () => {
  it('подпись роли берётся по полю DTO', () => {
    const show = (ref: UserRefDto) => USER_ROLE_LABELS[ref.role]
    expectTypeOf(show).returns.toEqualTypeOf<string>()
  })

  it('подпись уровня программы берётся по полю DTO кабинета вуза', () => {
    const show = (program: PortalProgramDto) => PROGRAM_LEVEL_LABELS[program.level]
    expectTypeOf(show).returns.toEqualTypeOf<string>()
  })

  it('подпись статуса этапа и связки', () => {
    const stage = (row: WorkflowStageDto) => STAGE_STATUS_LABELS[row.status]
    const coop = (row: CooperationDto) => COOPERATION_STATUS_LABELS[row.status]
    expectTypeOf(stage).returns.toEqualTypeOf<string>()
    expectTypeOf(coop).returns.toEqualTypeOf<string>()
  })

  it('рейтинг вуза и рейтинг программ описаны типами', () => {
    const university = (row: UniversityListItemDto): UniversityRatingDto | null => row.rating
    const program = (row: RankedProgramDto) => row.programName
    expectTypeOf(university).returns.toEqualTypeOf<UniversityRatingDto | null>()
    expectTypeOf(program).returns.toEqualTypeOf<string>()
  })

  it('словари подписей полны — на каждое значение есть слово', () => {
    expect(Object.keys(USER_ROLE_LABELS).length).toBeGreaterThan(0)
    expect(Object.values(PROGRAM_LEVEL_LABELS).every((label) => label.length > 0)).toBe(true)
  })
})
