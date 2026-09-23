import { describe, expect, it } from 'vitest'
import * as enums from './enums'
import * as labels from './labels'

/**
 * Подписи фронт берёт отсюда. Если у перечисления появится значение без подписи,
 * интерфейс покажет пустоту или код — тест ловит это до того, как увидит пользователь.
 */
const PAIRS: Array<[string, readonly string[], Record<string, string>]> = [
  ['UserRole', enums.USER_ROLES, labels.USER_ROLE_LABELS],
  ['UniversityStatus', enums.UNIVERSITY_STATUSES, labels.UNIVERSITY_STATUS_LABELS],
  ['ProgramLevel', enums.PROGRAM_LEVELS, labels.PROGRAM_LEVEL_LABELS],
  ['ProgramLevel (полные)', enums.PROGRAM_LEVELS, labels.PROGRAM_LEVEL_FULL_LABELS],
  ['ProgramStatus', enums.PROGRAM_STATUSES, labels.PROGRAM_STATUS_LABELS],
  ['SkillLevel', enums.SKILL_LEVELS, labels.SKILL_LEVEL_LABELS],
  ['SkillImportance', enums.SKILL_IMPORTANCE, labels.SKILL_IMPORTANCE_LABELS],
  ['DataOrigin', enums.DATA_ORIGINS, labels.DATA_ORIGIN_LABELS],
  ['ConfidenceLevel', enums.CONFIDENCE_LEVELS, labels.CONFIDENCE_LABELS],
  ['ProductStatus', enums.PRODUCT_STATUSES, labels.PRODUCT_STATUS_LABELS],
  ['ProductSkillRelevance', enums.PRODUCT_SKILL_RELEVANCE, labels.PRODUCT_SKILL_RELEVANCE_LABELS],
  ['CooperationStatus', enums.COOPERATION_STATUSES, labels.COOPERATION_STATUS_LABELS],
  ['StageStatus', enums.STAGE_STATUSES, labels.STAGE_STATUS_LABELS],
  ['StagePhase', enums.STAGE_PHASES, labels.STAGE_PHASE_LABELS],
  ['DocumentType', enums.DOCUMENT_TYPES, labels.DOCUMENT_TYPE_LABELS],
  ['DocumentStatus', enums.DOCUMENT_STATUSES, labels.DOCUMENT_STATUS_LABELS],
  ['MeetingFormat', enums.MEETING_FORMATS, labels.MEETING_FORMAT_LABELS],
  ['RecommendationType', enums.RECOMMENDATION_TYPES, labels.RECOMMENDATION_TYPE_LABELS],
  ['RecommendationPriority', enums.RECOMMENDATION_PRIORITIES, labels.RECOMMENDATION_PRIORITY_LABELS],
  ['RecommendationStatus', enums.RECOMMENDATION_STATUSES, labels.RECOMMENDATION_STATUS_LABELS],
  ['RecommendationStatus (действия)', enums.RECOMMENDATION_STATUSES, labels.RECOMMENDATION_STATUS_ACTIONS],
  ['DataSourceType', enums.DATA_SOURCE_TYPES, labels.DATA_SOURCE_TYPE_LABELS],
  ['ApplicationStatus', enums.APPLICATION_STATUSES, labels.APPLICATION_STATUS_LABELS],
]

describe('подписи к перечислениям', () => {
  for (const [name, values, dictionary] of PAIRS) {
    it(`${name}: подпись есть у каждого значения`, () => {
      const missing = values.filter((value) => !dictionary[value])
      expect(missing).toEqual([])
    })

    it(`${name}: нет подписей для несуществующих значений`, () => {
      const extra = Object.keys(dictionary).filter((key) => !values.includes(key))
      expect(extra).toEqual([])
    })

    it(`${name}: подписи на русском`, () => {
      const notRussian = Object.values(dictionary).filter((label) => !/[а-яА-Я]/.test(label))
      // СПО и ДПО — общепринятые сокращения, они допустимы.
      expect(notRussian.filter((label) => !['СПО', 'ДПО', 'LMS'].includes(label))).toEqual([])
    })
  }

  it('происхождение показателя тоже подписано', () => {
    expect(labels.METRIC_BASIS_LABELS.none).toBe('Нет данных')
    expect(labels.METRIC_BASIS_LABELS.actual.length).toBeGreaterThan(0)
    expect(labels.METRIC_BASIS_LABELS.estimate.length).toBeGreaterThan(0)
  })
})
