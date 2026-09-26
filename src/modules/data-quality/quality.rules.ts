import { QUALITY } from '@/shared/config/data-quality.config'
import type {
  DuplicateEntityType,
  QualityEntityReportDto,
  QualityEntityType,
  QualityIssueDto,
  QualityReportDto,
} from '@/shared/contracts/data-quality'
import { isAnonymizedContact } from '@/modules/universities/universities.rules'

/**
 * Отчёт «Качество справочника» (решение 134). Чистая функция: на входе записи
 * из базы и найденные дубли, на выходе оценка 0–100 и список проблем со ссылками.
 *
 * Оценка сущности: score = 100 × (1 − Σ weight_i × share_i), где share_i — доля записей
 * с проблемой i, веса проблем сущности в сумме дают 1 (QUALITY.issueWeights).
 * Все записи со всеми проблемами — 0, ни одной проблемы — 100.
 * Итог — среднее оценок сущностей с весами QUALITY.entityWeights; сущность без записей
 * в среднее не входит (её вес делится между остальными).
 */

const DAY = 24 * 60 * 60 * 1000
const round1 = (value: number) => Math.round(value * 10) / 10

export interface QualityInput {
  universities: Array<{
    id: string
    name: string
    isMock: boolean
    contacts: Array<{ fullName: string; position: string | null; email: string | null; phone: string | null }>
    programs: Array<{ id: string }>
  }>
  programs: Array<{
    id: string
    name: string
    isMock: boolean
    updatedAt: Date
    metricsUpdatedAt: Date | null
    skills: Array<{ updatedAt: Date }>
  }>
  skills: Array<{ id: string; name: string; _count: { programs: number; demand: number; products: number } }>
  products: Array<{ id: string; name: string; isMock: boolean; _count: { skills: number } }>
  cooperations: Array<{
    id: string
    isMock: boolean
    createdAt: Date
    university: { name: string }
    program: { name: string }
    responsible: { isActive: boolean }
    meetings: Array<{ date: Date }>
  }>
}

/** Записи, попавшие хотя бы в одну пару-кандидат в дубли, и число пар. */
export type DuplicateSummary = Record<DuplicateEntityType, { pairs: number; ids: ReadonlySet<string> }>

type Named = { id: string; name: string }

export const ENTITY_TITLES: Record<QualityEntityType, string> = {
  university: 'Вузы',
  program: 'Программы',
  skill: 'Навыки',
  product: 'IT-продукты',
  cooperation: 'Связки',
}

const HREF: Record<QualityEntityType, (id: string) => string> = {
  university: (id) => `/universities/${id}`,
  program: (id) => `/programs/${id}`,
  // Справочник навыков — во вкладке «Настройки» (решение 107): отдельной страницы у навыка нет.
  skill: () => '/settings',
  // У продукта отдельной страницы нет — реестр продуктов.
  product: () => '/products',
  cooperation: (id) => `/cooperations/${id}`,
}

export function hrefOf(entity: QualityEntityType, id: string): string {
  return HREF[entity](id)
}

interface IssueDraft {
  code: string
  title: string
  weight: number
  affected: Named[]
}

function buildEntity(entity: QualityEntityType, total: number, drafts: IssueDraft[]): QualityEntityReportDto {
  const issues: QualityIssueDto[] = drafts.map((draft) => {
    const share = total === 0 ? 0 : draft.affected.length / total
    return {
      code: draft.code,
      title: draft.title,
      count: draft.affected.length,
      share: Math.round(share * 1000) / 1000,
      weight: draft.weight,
      penalty: round1(100 * draft.weight * share),
      items: draft.affected
        .slice(0, QUALITY.sampleLimit)
        .map((item) => ({ id: item.id, name: item.name, href: hrefOf(entity, item.id) })),
    }
  })
  const penalty = drafts.reduce(
    (sum, draft) => sum + draft.weight * (total === 0 ? 0 : draft.affected.length / total),
    0,
  )
  return {
    entity,
    title: ENTITY_TITLES[entity],
    total,
    score: total === 0 ? null : round1(Math.max(0, 100 * (1 - penalty))),
    weight: QUALITY.entityWeights[entity],
    issues,
  }
}

/** Когда программу обновляли в последний раз: запись, показатели или навыки. */
export function programLastUpdate(program: QualityInput['programs'][number]): Date {
  const dates = [program.updatedAt, program.metricsUpdatedAt, ...program.skills.map((skill) => skill.updatedAt)]
  return new Date(Math.max(...dates.filter((date): date is Date => date !== null).map((date) => date.getTime())))
}

export function computeQualityReport(input: QualityInput, duplicates: DuplicateSummary, now: Date): QualityReportDto {
  const weights = QUALITY.issueWeights
  const staleBefore = now.getTime() - QUALITY.programStaleDays * DAY
  const quietBefore = now.getTime() - QUALITY.cooperationNoMeetingDays * DAY
  const inDuplicates = (entity: DuplicateEntityType) => (item: Named) => duplicates[entity].ids.has(item.id)

  const university = buildEntity('university', input.universities.length, [
    {
      code: 'university.noContacts',
      title: 'Вуз без контактных лиц',
      weight: weights.university.noContacts,
      // Обезличенный контакт — это «контакта нет»: писать некому.
      affected: input.universities.filter((row) => row.contacts.every(isAnonymizedContact)),
    },
    {
      code: 'university.noPrograms',
      title: 'Вуз без действующих программ',
      weight: weights.university.noPrograms,
      affected: input.universities.filter((row) => row.programs.length === 0),
    },
    {
      code: 'university.duplicates',
      title: 'Вуз — кандидат в дубли',
      weight: weights.university.duplicates,
      affected: input.universities.filter(inDuplicates('university')),
    },
  ])

  const program = buildEntity('program', input.programs.length, [
    {
      code: 'program.noSkills',
      title: 'Программа без навыков',
      weight: weights.program.noSkills,
      affected: input.programs.filter((row) => row.skills.length === 0),
    },
    {
      code: 'program.stale',
      title: `Программа не обновлялась больше ${QUALITY.programStaleDays} дней`,
      weight: weights.program.stale,
      affected: input.programs.filter((row) => programLastUpdate(row).getTime() < staleBefore),
    },
    {
      code: 'program.duplicates',
      title: 'Программа — кандидат в дубли',
      weight: weights.program.duplicates,
      affected: input.programs.filter(inDuplicates('program')),
    },
  ])

  const skill = buildEntity('skill', input.skills.length, [
    {
      code: 'skill.demandWithoutPrograms',
      title: 'Навык нужен рынку, но ни одна программа его не даёт («дыра»)',
      weight: weights.skill.demandWithoutPrograms,
      affected: input.skills.filter((row) => row._count.demand > 0 && row._count.programs === 0),
    },
    {
      code: 'skill.unused',
      title: 'Навык без спроса и без программ (кандидат на удаление)',
      weight: weights.skill.unused,
      affected: input.skills.filter((row) => row._count.demand === 0 && row._count.programs === 0),
    },
    {
      code: 'skill.duplicates',
      title: 'Навык — кандидат в дубли',
      weight: weights.skill.duplicates,
      affected: input.skills.filter(inDuplicates('skill')),
    },
  ])

  const product = buildEntity('product', input.products.length, [
    {
      code: 'product.noSkills',
      title: 'IT-продукт без навыков: его нельзя предложить под дефицит',
      weight: weights.product.noSkills,
      affected: input.products.filter((row) => row._count.skills === 0),
    },
    {
      code: 'product.duplicates',
      title: 'IT-продукт — кандидат в дубли',
      weight: weights.product.duplicates,
      affected: input.products.filter(inDuplicates('product')),
    },
  ])

  const cooperationName = (row: QualityInput['cooperations'][number]): Named => ({
    id: row.id,
    name: `${row.university.name} — ${row.program.name}`,
  })
  const cooperation = buildEntity('cooperation', input.cooperations.length, [
    {
      code: 'cooperation.noResponsible',
      title: 'Ответственный за связку заблокирован — связку никто не ведёт',
      weight: weights.cooperation.noResponsible,
      affected: input.cooperations.filter((row) => !row.responsible.isActive).map(cooperationName),
    },
    {
      code: 'cooperation.noMeetings',
      title: `Открытая связка без встреч больше ${QUALITY.cooperationNoMeetingDays} дней`,
      weight: weights.cooperation.noMeetings,
      // Отсчёт — от последней встречи, а без встреч — от создания: вчерашняя связка не «заброшена».
      affected: input.cooperations
        .filter((row) => (row.meetings[0]?.date ?? row.createdAt).getTime() < quietBefore)
        .map(cooperationName),
    },
  ])

  const entities = [university, program, skill, product, cooperation]
  const rated = entities.filter((entity) => entity.score !== null)
  const weightSum = rated.reduce((sum, entity) => sum + entity.weight, 0)
  const score =
    rated.length === 0 || weightSum === 0
      ? null
      : round1(rated.reduce((sum, entity) => sum + entity.weight * entity.score!, 0) / weightSum)

  const isMock =
    input.universities.some((row) => row.isMock) ||
    input.programs.some((row) => row.isMock) ||
    input.products.some((row) => row.isMock) ||
    input.cooperations.some((row) => row.isMock)

  return {
    score,
    entities,
    duplicates: {
      university: duplicates.university.pairs,
      skill: duplicates.skill.pairs,
      program: duplicates.program.pairs,
      product: duplicates.product.pairs,
    },
    explanation: explain(entities),
    generatedAt: now.toISOString(),
    isMock,
  }
}

function explain(entities: QualityEntityReportDto[]): string {
  const parts = entities
    .filter((entity) => entity.score !== null)
    .map((entity) => `${entity.title} ${entity.score} × ${entity.weight}`)
  return (
    'Оценка сущности = 100 × (1 − Σ вес проблемы × доля записей с ней); веса проблем сущности в сумме 1. ' +
    `Итог — взвешенное среднее: ${parts.join(', ')}. ` +
    'Архивные записи и закрытые связки не учитываются; дубли — пары выше порога без отмеченных «не дубль».'
  )
}
