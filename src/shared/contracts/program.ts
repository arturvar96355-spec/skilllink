import type { ProgramRatingDto } from './rating'
import type { Metric } from './common'
import type {
  ConfidenceLevel,
  DataOrigin,
  ProgramLevel,
  ProgramStatus,
  SkillImportance,
  SkillLevel,
} from './enums'

export interface ProgramSkillDto {
  skillId: string
  name: string
  category: string
  level: SkillLevel
  importance: SkillImportance
  source: DataOrigin
  confidence: ConfidenceLevel | null
  comment: string | null
}

/** Показатели набора (раздел 7.4 ТЗ). null означает «Нет данных». */
export interface ProgramMetricsDto {
  applicationCount: Metric
  studentCount: Metric
  groupCount: Metric
}

export interface ProgramListItemDto {
  id: string
  universityId: string
  universityName: string
  name: string
  code: string | null
  direction: string | null
  level: ProgramLevel
  durationMonths: number | null
  status: ProgramStatus
  metrics: ProgramMetricsDto
  skillCount: number
  cooperationCount: number
  isMock: boolean
  updatedAt: string
}

export interface ProgramDto extends ProgramListItemDto {
  skills: ProgramSkillDto[]
  createdAt: string
  archivedAt: string | null
  /**
   * Рейтинг программы — для заголовка карточки. Та же шкала, что в
   * `GET /api/analytics/programs`, поэтому балл совпадает с рейтингом.
   * null — рейтинг недоступен роли (представитель вуза); `score: null` внутри —
   * «Нет данных» или программа не действует.
   */
  rating: ProgramRatingDto | null
}
