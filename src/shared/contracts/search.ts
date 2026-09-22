/**
 * Глобальный поиск — ответ `GET /api/search`, окно поиска в стиле Spotlight.
 *
 * Результаты сгруппированы по разделам в постоянном порядке. Пустые группы
 * не приходят. Ссылку фронт строит сам по `type` и `id`: так же, как для любого
 * другого объекта, и маршруты страниц остаются его решением.
 */
export const SEARCH_ENTITY_TYPES = [
  'university',
  'program',
  'cooperation',
  'product',
  'skill',
  'document',
] as const
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

export interface SearchItemDto {
  type: SearchEntityType
  id: string
  title: string
  /** Уточнение под заголовком: город вуза, вуз программы, продукт связки. */
  subtitle: string | null
}

export interface SearchGroupDto {
  type: SearchEntityType
  /** Название раздела для заголовка группы: «Университеты», «Программы»… */
  title: string
  /** Сколько всего нашлось в разделе — показано может быть меньше. */
  total: number
  items: SearchItemDto[]
}

export interface SearchResultDto {
  query: string
  groups: SearchGroupDto[]
}
