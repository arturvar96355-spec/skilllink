import type { UserRefDto } from './workflow'

/**
 * Качество данных, дубли, слияние вузов, лента 360, похожие программы,
 * тепловая карта встреч (решение 134).
 */

// ──────────────────────────────────── Дубли ───────────────────────────────────

export const DUPLICATE_ENTITY_TYPES = ['university', 'skill', 'program', 'product'] as const
export type DuplicateEntityType = (typeof DUPLICATE_ENTITY_TYPES)[number]

/**
 * Как найдено сходство:
 * - `inn` — совпал ИНН;
 * - `normalized` — названия совпали после нормализации (регистр, «ё», кавычки, пробелы);
 * - `synonym` — совпали по словарю синонимов (js — javascript);
 * - `abbreviation` — аббревиатура или сокращение (МТУСИ, «ун-т»);
 * - `trigram` — сходство по триграммам;
 * - `levenshtein` — одна-две правки в коротком названии (опечатка).
 */
export const DUPLICATE_METHODS = ['inn', 'normalized', 'synonym', 'abbreviation', 'trigram', 'levenshtein'] as const
export type DuplicateMethod = (typeof DUPLICATE_METHODS)[number]

/** Запись в паре дублей: ровно то, что нужно, чтобы её узнать и открыть. */
export interface DuplicateRecordDto {
  id: string
  name: string
  /** Уточнение: город вуза, категория навыка, вуз и уровень программы. */
  hint: string | null
  /** Ссылка на карточку в интерфейсе. */
  href: string
}

export interface DuplicatePairDto {
  entity: DuplicateEntityType
  /** Внутри пары записи упорядочены по id — в таком виде пара отмечается «не дубль». */
  a: DuplicateRecordDto
  b: DuplicateRecordDto
  /** Сходство 0..1, три знака. */
  score: number
  method: DuplicateMethod
  /** Почему пара похожа — словами, для показа как есть. */
  reasons: string[]
  /** Пара отмечена «не дубль» (приходит только при includeDismissed=true). */
  dismissed: boolean
}

export interface DuplicatesMetaDto {
  entity: DuplicateEntityType
  threshold: number
  /** Сколько записей сравнивалось. */
  compared: number
  /** Кто отобрал пары: все со всеми в приложении или кандидаты базы по pg_trgm. */
  candidateSource: 'all-pairs' | 'pg_trgm'
  /** Пар выше порога до обрезки по maxPairs. */
  total: number
  /** Сколько пар скрыто как «не дубль». */
  dismissedHidden: number
}

export interface DuplicateDismissalDto {
  id: string
  entity: DuplicateEntityType
  firstId: string
  secondId: string
  comment: string | null
  dismissedBy: UserRefDto
  createdAt: string
}

// ──────────────────────────────── Отчёт качества ──────────────────────────────

export const QUALITY_ENTITY_TYPES = ['university', 'program', 'skill', 'product', 'cooperation'] as const
export type QualityEntityType = (typeof QUALITY_ENTITY_TYPES)[number]

export interface QualityIssueDto {
  /** Код проблемы: `university.noContacts`, `program.stale`… */
  code: string
  title: string
  /** Записей с проблемой. */
  count: number
  /** Доля от записей сущности, 0..1. */
  share: number
  /** Вес проблемы в оценке сущности. */
  weight: number
  /** Сколько баллов из 100 проблема отняла у сущности: 100 × вес × доля. */
  penalty: number
  /** Примеры — до sampleLimit записей со ссылками. */
  items: Array<{ id: string; name: string; href: string }>
}

export interface QualityEntityReportDto {
  entity: QualityEntityType
  title: string
  /** Записей в расчёте (без архивных). */
  total: number
  /** 0..100; null — записей нет, оценивать нечего. */
  score: number | null
  weight: number
  issues: QualityIssueDto[]
}

export interface QualityReportDto {
  /** Итоговая оценка 0..100; null — справочник пуст. */
  score: number | null
  entities: QualityEntityReportDto[]
  /** Кандидатов в дубли (пар выше порога, без отмеченных «не дубль») по сущностям. */
  duplicates: Record<DuplicateEntityType, number>
  /** Формула словами — для показа под оценкой. */
  explanation: string
  generatedAt: string
  /** В справочнике есть демонстрационные записи. */
  isMock: boolean
}

// ──────────────────────────────── Слияние вузов ───────────────────────────────

/**
 * Правило выбора значения поля при слиянии:
 * - `non_null` — значение цели, а если его нет — источника (пустое никогда не побеждает);
 * - `most_recent` — из записи, обновлённой позже (пустое не побеждает);
 * - `longest` — более длинная строка или большее число;
 * - `manual` — значение задаёт администратор (`manualValues`).
 */
export const MERGE_FIELD_RULES = ['non_null', 'most_recent', 'longest', 'manual'] as const
export type MergeFieldRule = (typeof MERGE_FIELD_RULES)[number]

export const MERGEABLE_UNIVERSITY_FIELDS = [
  'name',
  'shortName',
  'city',
  'region',
  'address',
  'website',
  'description',
  'directionCount',
  'studentCount',
  'inn',
  'ogrn',
] as const
export type MergeableUniversityField = (typeof MERGEABLE_UNIVERSITY_FIELDS)[number]

/** Запись журнала выживания: чьё значение поля осталось и по какому правилу. */
export interface SurvivorshipEntryDto {
  field: MergeableUniversityField
  rule: MergeFieldRule
  /** `target` — осталось значение цели, `source` — взято из источника, `manual` — задано вручную. */
  chosen: 'target' | 'source' | 'manual'
  /** Изменилось ли поле цели. */
  changed: boolean
  targetValue: string | number | null
  sourceValue: string | number | null
  resultValue: string | number | null
}

export interface MergedObjectsCountDto {
  programs: number
  contacts: number
  cooperations: number
  meetings: number
  documents: number
  applications: number
  users: number
}

export interface UniversityMergeDto {
  id: string
  sourceId: string
  targetId: string
  mergedBy: UserRefDto
  mergedAt: string
  /** До какого момента слияние можно отменить. */
  undoUntil: string
  undoneAt: string | null
  moved: MergedObjectsCountDto
  survivorship: SurvivorshipEntryDto[]
  /** Контакты источника, у которых снят признак «основной»: у цели основной уже есть. */
  demotedPrimaryContacts: number
}

export interface UniversityMergeUndoDto {
  merge: UniversityMergeDto
  /** Возвращено источнику — включая объекты, появившиеся на перенесённых программах и связках. */
  returned: MergedObjectsCountDto
  /** Поля цели, возвращённые к значению до слияния. */
  restoredFields: MergeableUniversityField[]
  /** Поля, изменённые после слияния: их значение сохранено, а не откатано. */
  keptFields: MergeableUniversityField[]
}

// ─────────────────────────────────── Лента 360 ─────────────────────────────────

export const TIMELINE_EVENT_TYPES = [
  'cooperation',
  'stage',
  'meeting',
  'document',
  'application',
  'recommendation',
  'contact',
  'audit',
] as const
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number]

export interface TimelineEventDto {
  /** Уникален в ленте: `<тип>:<id записи>`. */
  id: string
  type: TimelineEventType
  /** Уточнение: `stage.status`, `recommendation.created`, `contact.basis.set`, `university.merge`… */
  kind: string
  title: string
  details: string | null
  cooperationId: string | null
  programName: string | null
  /** Ссылка на объект в интерфейсе, если у него есть страница. */
  href: string | null
  author: UserRefDto | null
  occurredAt: string
}

export interface TimelineMetaDto {
  limit: number
  /** Курсор следующей страницы; null — показано всё. */
  nextCursor: string | null
  hasMore: boolean
  /** Типы, которые вошли в ленту: запрошенные и разрешённые роли. */
  types: TimelineEventType[]
}

// ─────────────────────────────── Похожие программы ────────────────────────────

export interface SkillRefDto {
  id: string
  name: string
}

export interface SimilarProgramDto {
  program: {
    id: string
    name: string
    universityId: string
    universityName: string
    level: string
    direction: string | null
  }
  /** Итоговое сходство 0..1: косинус навыков и бонусы. */
  score: number
  /** Косинус взвешенных векторов навыков 0..1. */
  cosine: number
  sameDirection: boolean
  sameLevel: boolean
  sharedSkills: SkillRefDto[]
  /** Навыки похожей программы, которых нет у этой. */
  missingSkills: SkillRefDto[]
}

export interface SimilarProgramsDto {
  programId: string
  items: SimilarProgramDto[]
  /** «Чего не хватает этой программе, что есть у похожих»: чем больше программ и сходство — тем выше. */
  missingSummary: Array<SkillRefDto & { programCount: number; weight: number }>
  explanation: string
}

// ─────────────────────────────── Тепловая карта ───────────────────────────────

export interface MeetingsHeatmapDto {
  /** 7 строк (пн … вс) × 24 столбца (часы 0–23) — число проведённых встреч. */
  cells: number[][]
  dayLabels: string[]
  timeZone: string
  total: number
  /** Наибольшее значение клетки — для шкалы цвета. */
  max: number
  from: string | null
  to: string
  isMock: boolean
}
