import {
  DUPLICATE_ENTITY_TYPES,
  type DuplicateEntityType,
  type QualityEntityReportDto,
  type QualityIssueDto,
  type QualityReportDto,
} from '@/shared/contracts'
import { plural } from '@/shared/utils/text'

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

/** Цель индекса: от неё — «всё хорошо». TEMP: согласовать с Артуром. */
export const QUALITY_TARGET = 90 // TEMP
/** Ниже этого — «критично». TEMP: согласовать с Артуром. */
export const QUALITY_CRITICAL_BELOW = 75 // TEMP

/** Общий вердикт по оценке 0–100 — те же пороги у индекса и у каждого справочника. */
export function scoreLevel(score: number | null): QualityLevel | null {
  if (score === null) return null
  if (score >= QUALITY_TARGET) return 'ok'
  if (score >= QUALITY_CRITICAL_BELOW) return 'attention'
  return 'critical'
}

/** Баллы — с одной цифрой после запятой, по-русски: «27,4». */
export function formatPoints(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

/** «балл», «балла», «баллов» — по последнему числу; дробное — всегда «балла». */
export function pointsWord(value: number): string {
  if (!Number.isInteger(Math.round(value * 10) / 10)) return 'балла'
  const n = Math.abs(Math.round(value)) % 100
  if (n % 10 === 1 && n !== 11) return 'балл'
  if (n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14)) return 'балла'
  return 'баллов'
}

/**
 * Отклонение от цели словами (правило диаграмм 4): «ниже цели на 17,4»,
 * «выше цели на 2,6», «ровно на цели». `withTarget` — назвать саму цель
 * («ниже цели 90 на 17,4»). Без оценки — «нет данных».
 */
export function deviationText(score: number | null, withTarget = false): string {
  if (score === null) return 'нет данных'
  const gap = Math.round((score - QUALITY_TARGET) * 10) / 10
  const target = withTarget ? `цели ${QUALITY_TARGET}` : 'цели'
  if (gap === 0) return `ровно на ${target}`
  return `${gap > 0 ? 'выше' : 'ниже'} ${target} на ${formatPoints(Math.abs(gap))}`
}

/**
 * Справочники от худшего к лучшему (правило 6: сортировка отвечает на вопрос
 * «где хуже»); без оценки (записей нет) — в конце.
 */
export function entitiesWorstFirst(report: QualityReportDto): QualityEntityReportDto[] {
  return [...report.entities].sort((a, b) => {
    if (a.score === null) return b.score === null ? 0 : 1
    if (b.score === null) return -1
    return a.score - b.score
  })
}

/**
 * Вывод одной фразой под индексом (правило 7) — из данных, а не общими словами:
 * называет проверку, которая отнимает больше всего баллов.
 */
export function qualityConclusion(report: QualityReportDto): string {
  if (report.score === null) return 'Справочники пусты — оценивать пока нечего.'
  const groups = groupIssues(report)
  const worst = [...groups.critical, ...groups.attention][0]
  if (!worst) return 'Все проверки проходят: ни одна не отнимает баллов у справочников.'
  const { issue } = worst
  const failing = groups.critical.length + groups.attention.length
  return (
    `Больше всего баллов отнимает «${issue.title}»: ${issue.count} из ${worst.entityTotal}, ` +
    `−${formatPoints(issue.penalty)} ${pointsWord(issue.penalty)} у справочника «${worst.entityTitle}». ` +
    `Замечания — у ${failing} из ${failing + groups.ok.length} проверок.`
  )
}

/** Что делать с проверкой: разобрать пары дублей, исправить запись или открыть реестр. */
export type IssueAction =
  | { kind: 'duplicates'; entity: DuplicateEntityType }
  | { kind: 'link'; href: string; label: 'Исправить' | 'Открыть' }

export function issueAction(issue: QualityIssueDto): IssueAction | null {
  if (issue.count === 0) return null
  const [entity, check] = issue.code.split('.')
  if (check === 'duplicates' && (DUPLICATE_ENTITY_TYPES as readonly string[]).includes(entity ?? '')) {
    return { kind: 'duplicates', entity: entity as DuplicateEntityType }
  }
  const first = issue.items[0]
  if (!first) return null
  // Ссылка на саму запись (…/id) — «Исправить»; на общий реестр или настройки — «Открыть».
  const label = first.href.endsWith(`/${first.id}`) ? 'Исправить' : 'Открыть'
  return { kind: 'link', href: first.href, label }
}

/**
 * Почему проверка важна — одной строкой (решение 212). Эксперт спросил, есть ли
 * в «качестве данных» смысл: смысл в том, что каждая дыра в справочнике ломает
 * конкретную работу. Ключ — код проверки с сервера (`quality.rules.ts`); полноту
 * списка сторожит тест.
 */
export const ISSUE_WHY: Record<string, string> = {
  'university.noContacts': 'Без контактов не с кем согласовать этап и некому отправить документы.',
  'university.noPrograms': 'Без действующей программы связку с вузом не собрать — работать не над чем.',
  'university.duplicates': 'Один вуз двумя записями делит историю, документы и числа отчётов пополам.',
  'program.noSkills': 'Без навыков программе не подобрать IT-продукт и не посчитать дефицит.',
  'program.stale': 'Старые показатели искажают рейтинг программ и прогноз связок.',
  'program.duplicates': 'Дубль программы раздваивает заявки, обучающихся и рейтинг.',
  'skill.demandWithoutPrograms': 'Рынку навык нужен, а учить ему негде — подсказка, какую программу предложить вузу.',
  'skill.unused': 'Лишний навык засоряет справочник и подбор продуктов под дефицит.',
  'skill.duplicates': 'Один навык под двумя названиями дробит спрос и дефициты.',
  'product.noSkills': 'Продукт без навыков не попадёт в подбор под дефицит — его никто не предложит.',
  'product.duplicates': 'Дубль продукта раздваивает связки и лицензии.',
  'cooperation.noResponsible': 'Связку без действующего ответственного никто не ведёт — сроки сорвутся незаметно.',
  'cooperation.noMeetings': 'Долгое молчание — первый признак, что связка застряла.',
}

/** Как проверка звучит в сводке: «12 вузов без контактов». */
export const ISSUE_NOUNS: Record<string, [string, string, string]> = {
  'university.noContacts': ['вуз без контактов', 'вуза без контактов', 'вузов без контактов'],
  'university.noPrograms': ['вуз без программ', 'вуза без программ', 'вузов без программ'],
  'university.duplicates': ['вуз похож на дубль', 'вуза похожи на дубли', 'вузов похожи на дубли'],
  'program.noSkills': ['программа без навыков', 'программы без навыков', 'программ без навыков'],
  'program.stale': ['программа давно не обновлялась', 'программы давно не обновлялись', 'программ давно не обновлялись'],
  'program.duplicates': ['программа похожа на дубль', 'программы похожи на дубли', 'программ похожи на дубли'],
  'skill.demandWithoutPrograms': [
    'навык нужен рынку, но не преподаётся',
    'навыка нужны рынку, но не преподаются',
    'навыков нужны рынку, но не преподаются',
  ],
  'skill.unused': ['навык без спроса и программ', 'навыка без спроса и программ', 'навыков без спроса и программ'],
  'skill.duplicates': ['навык похож на дубль', 'навыка похожи на дубли', 'навыков похожи на дубли'],
  'product.noSkills': ['IT-продукт без навыков', 'IT-продукта без навыков', 'IT-продуктов без навыков'],
  'product.duplicates': ['IT-продукт похож на дубль', 'IT-продукта похожи на дубли', 'IT-продуктов похожи на дубли'],
  'cooperation.noResponsible': ['связка без ответственного', 'связки без ответственного', 'связок без ответственного'],
  'cooperation.noMeetings': ['связка давно без встреч', 'связки давно без встреч', 'связок давно без встреч'],
}

/** Сколько проверок назвать в сводке поимённо; остальные — «и ещё N». */
const SUMMARY_ISSUES = 4

function count(value: number): string {
  return value.toLocaleString('ru-RU')
}

/**
 * Главная фраза страницы (решение 212): не индекс, а сколько записей править
 * и каких — «14 записей требуют правки: 6 вузов без контактов, 5 программ без
 * навыков…». Число записей — без повторов (`recordsToFix`): запись с двумя
 * замечаниями — одна запись к правке. Проверки — по числу записей, крупные первыми.
 */
export function qualitySummary(report: QualityReportDto): string {
  if (report.score === null) return 'Справочники пусты — проверять пока нечего.'
  const failing = report.entities
    .flatMap((entity) => entity.issues)
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count)
  if (report.recordsToFix === 0 || failing.length === 0) {
    return 'Все записи в порядке: ни одна проверка не нашла, что править.'
  }
  const named = failing.slice(0, SUMMARY_ISSUES).map((issue) => {
    const nouns = ISSUE_NOUNS[issue.code]
    return nouns ? `${count(issue.count)} ${plural(issue.count, nouns)}` : `${issue.title.toLowerCase()}: ${count(issue.count)}`
  })
  const rest = failing.length - named.length
  const tail = rest > 0 ? ` и ещё ${count(rest)} ${plural(rest, ['проверка', 'проверки', 'проверок'])}` : ''
  const head = `${count(report.recordsToFix)} ${plural(report.recordsToFix, ['запись требует', 'записи требуют', 'записей требуют'])} правки`
  return `${head}: ${named.join(', ')}${tail}.`
}
