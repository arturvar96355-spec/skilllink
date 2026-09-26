import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import {
  COOPERATION_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  PROGRAM_LEVEL_LABELS,
} from '@/shared/contracts/labels'
import type { SearchGroupDto, SearchItemDto, SearchResultDto } from '@/shared/contracts/search'
import * as cooperations from '@/modules/cooperation/cooperation.service'
import { cooperationListQuerySchema } from '@/modules/cooperation/cooperation.schema'
import * as documents from '@/modules/documents/documents.service'
import { documentListQuerySchema } from '@/modules/documents/documents.schema'
import * as products from '@/modules/products/products.service'
import { productListQuerySchema } from '@/modules/products/products.schema'
import * as programs from '@/modules/programs/programs.service'
import { programListQuerySchema } from '@/modules/programs/programs.schema'
import * as skills from '@/modules/skills/skills.service'
import { skillListQuerySchema } from '@/modules/skills/skills.schema'
import * as universities from '@/modules/universities/universities.service'
import { universityListQuerySchema } from '@/modules/universities/universities.schema'
import type { SearchQuery } from './search.schema'

function joined(...parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(' · ') : null
}

/**
 * Связка в выдаче — так же, как в реестре: «СПбГУТ — Программная инженерия».
 * Полное имя вуза длиннее строки окна и обрезается раньше, чем доходит до программы.
 */
export function cooperationTitle(row: {
  universityName: string
  universityShortName: string | null
  programName: string
}): string {
  return `${row.universityShortName ?? row.universityName} — ${row.programName}`
}

function group(
  type: SearchGroupDto['type'],
  title: string,
  total: number,
  items: SearchItemDto[],
): SearchGroupDto {
  return { type, title, total, items }
}

/**
 * Глобальный поиск по разделам.
 *
 * Собран из тех же списков, что открывает фронт, а не отдельным запросом к базе:
 * списки уже проверяют права и сами ограничивают представителя вуза его вузом.
 * Свой запрос пришлось бы защищать заново — и одно упущение показало бы
 * чужой вуз в строке поиска.
 *
 * Сотрудники отдельной группой не выводятся: страницы сотрудника нет, вести
 * такой результат некуда, а список пользователей закрыт для представителя вуза.
 * Фамилия ответственного ищется в связках — результатом приходят его связки.
 */
export async function search(user: CurrentUser, query: SearchQuery): Promise<SearchResultDto> {
  assertCan(user, 'READ')
  const base = { q: query.q, page: '1', pageSize: String(query.limit) }

  const [u, p, c, pr, s, d] = await Promise.all([
    // Рейтинг в строке поиска не показывается — считать его незачем.
    universities.list(user, universityListQuerySchema.parse({ ...base, withRating: 'false' })),
    programs.list(user, programListQuerySchema.parse(base)),
    cooperations.list(user, cooperationListQuerySchema.parse(base)),
    products.list(user, productListQuerySchema.parse(base)),
    skills.list(user, skillListQuerySchema.parse(base)),
    documents.list(user, documentListQuerySchema.parse(base)),
  ])

  const groups: SearchGroupDto[] = [
    group(
      'university',
      'Вузы',
      u.meta.total,
      u.data.map((row) => ({
        type: 'university',
        id: row.id,
        title: row.name,
        subtitle: joined(row.shortName, row.city),
      })),
    ),
    group(
      'program',
      'Программы',
      p.meta.total,
      p.data.map((row) => ({
        type: 'program',
        id: row.id,
        title: row.name,
        subtitle: joined(row.universityName, PROGRAM_LEVEL_LABELS[row.level]),
      })),
    ),
    group(
      'cooperation',
      'Сотрудничества',
      c.meta.total,
      c.data.map((row) => ({
        type: 'cooperation',
        id: row.id,
        title: cooperationTitle(row),
        // Ответственный — в подписи: связку ищут и по его фамилии, и без него
        // было бы непонятно, почему она нашлась.
        subtitle: joined(
          row.productName ?? 'Продукт не выбран',
          COOPERATION_STATUS_LABELS[row.status],
          row.responsible.fullName,
        ),
      })),
    ),
    group(
      'product',
      'IT-продукты',
      pr.meta.total,
      pr.data.map((row) => ({
        type: 'product',
        id: row.id,
        title: row.name,
        subtitle: joined(row.category, row.version),
      })),
    ),
    group(
      'skill',
      'Навыки',
      s.meta.total,
      s.data.map((row) => ({ type: 'skill', id: row.id, title: row.name, subtitle: row.category })),
    ),
    group(
      'document',
      'Документы',
      d.meta.total,
      d.data.map((row) => ({
        type: 'document',
        id: row.id,
        title: row.title,
        subtitle: joined(DOCUMENT_TYPE_LABELS[row.type], row.links.universityName),
      })),
    ),
  ]

  return { query: query.q, groups: groups.filter((item) => item.items.length > 0) }
}
