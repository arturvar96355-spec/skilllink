import type { Permission } from '@/shared/auth/permissions'
import type { HelpGroupId, HelpTopicId } from './topics'

/** Вопрос и ответ из «Частых вопросов». */
export interface HelpFaq {
  q: string
  a: string
}

/** «Где найти» — экран системы. `href` обязан вести на существующую страницу (тест). */
export interface HelpWhere {
  href: string
  label: string
}

/** Колонки таблицы прав: шесть ролей и эксперт хакатона. */
export type HelpRoleColumn = 'ADMIN' | 'HEAD' | 'MANAGER' | 'ANALYST' | 'VIEWER' | 'UNIVERSITY_REP' | 'REVIEWER'

/**
 * Строка таблицы «Роли и права». `permission` — право из `permissions.ts`, по
 * которому строка сверяется тестом: «да» в ячейке роли ⇔ роль есть в праве.
 * `cells` — что показать, если ответ не просто «да» / «нет» («свой вуз»).
 */
export interface HelpRightsRow {
  label: string
  permission?: Permission
  cells: Record<HelpRoleColumn, string>
}

export interface HelpTopicBody {
  /** Что это — один-два абзаца. */
  about: string[]
  /** Зачем это нужно — одним абзацем. */
  why: string
  /** Кто может — роли словами. */
  who: string
  /** Как пользоваться — по шагам, с точными названиями кнопок. */
  steps: string[]
  /** Частые вопросы — от трёх до пяти. */
  faq: HelpFaq[]
  /** Где найти в системе. */
  where: HelpWhere
  /** Таблица — только у раздела «Роли и права». */
  rights?: HelpRightsRow[]
}

/**
 * Подраздел — кнопка или блок экрана (решение 217): краткая часть из `tools.ts`
 * и полный текст из `content/tools.ts`. `anchor` — `<раздел>--<подраздел>`.
 */
export interface HelpToolSection {
  key: string
  anchor: string
  title: string
  short: string
  how: string
  who: string
  details: readonly string[]
}

/** Раздел целиком: краткая часть из `topics.ts` и полный текст. */
export interface HelpSection extends HelpTopicBody {
  id: HelpTopicId
  group: HelpGroupId
  title: string
  short: string
  how: string
  /** Кнопки и блоки экрана — пусто, если подразделов у раздела нет. */
  tools: readonly HelpToolSection[]
}

export interface HelpTerm {
  term: string
  definition: string
}
