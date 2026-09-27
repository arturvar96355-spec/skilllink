import { CATALOG_BODIES } from './content/catalog'
import { COOPERATION_BODIES } from './content/cooperations'
import { NOTIFY_TECH_BODIES } from './content/notify-tech'
import { REPORTS_ADMIN_BODIES } from './content/reports-admin'
import { START_BODIES } from './content/start'
import { TEAM_LETTERS_BODIES } from './content/team-letters'
import { TOOL_BODIES, type HelpToolBody } from './content/tools'
import { HELP_TOOLS, type HelpToolSummary } from './tools'
import { HELP_GROUPS, HELP_TOPICS, HELP_TOPIC_IDS, helpAnchor, type HelpGroupId, type HelpTopicId } from './topics'
import type { HelpSection, HelpToolSection, HelpTopicBody } from './types'

/**
 * Документация SkillLink целиком (решение 214): краткая часть из `topics.ts`
 * и полный текст из `content/*`. Этот модуль — для страниц документации и
 * генератора `docs/USER_GUIDE.md`; подсказке `HelpHint` достаточно `topics.ts`.
 *
 * Тип ниже требует полный текст у каждого ключа `HELP_TOPICS` и не пропускает
 * лишних: забытый или опечатанный раздел — ошибка сборки, а не пустое место
 * на странице.
 */
const BODIES: Record<HelpTopicId, HelpTopicBody> = {
  ...START_BODIES,
  ...COOPERATION_BODIES,
  ...CATALOG_BODIES,
  ...TEAM_LETTERS_BODIES,
  ...REPORTS_ADMIN_BODIES,
  ...NOTIFY_TECH_BODIES,
}

/** Подразделы раздела в порядке реестра `tools.ts` — с полным текстом из `content/tools.ts`. */
function toolSections(id: HelpTopicId): HelpToolSection[] {
  const summaries = (HELP_TOOLS as Readonly<Partial<Record<HelpTopicId, Readonly<Record<string, HelpToolSummary>>>>>)[id]
  const bodies = (TOOL_BODIES as Readonly<Partial<Record<HelpTopicId, Readonly<Record<string, HelpToolBody>>>>>)[id]
  if (!summaries) return []
  return Object.entries(summaries).map(([key, summary]) => {
    const body = bodies?.[key]
    return {
      key,
      anchor: helpAnchor(id, key),
      ...summary,
      who: body?.who ?? '',
      details: body?.details ?? [],
    }
  })
}

export const HELP_SECTIONS: readonly HelpSection[] = HELP_TOPIC_IDS.map((id) => ({
  id,
  ...HELP_TOPICS[id],
  ...BODIES[id],
  tools: toolSections(id),
}))

export interface HelpSectionGroup {
  id: HelpGroupId
  title: string
  sections: readonly HelpSection[]
}

/** Разделы по группам — в порядке оглавления. Пустых групп нет. */
export const HELP_SECTION_GROUPS: readonly HelpSectionGroup[] = HELP_GROUPS.map((group) => ({
  ...group,
  sections: HELP_SECTIONS.filter((section) => section.group === group.id),
})).filter((group) => group.sections.length > 0)

/** Якорь словаря терминов — не пересекается с ключами разделов (тест). */
export const HELP_TERMS_ANCHOR = 'terms'

/** Роли — колонки таблицы прав, по порядку. */
export const HELP_ROLE_COLUMNS = [
  { key: 'ADMIN', label: 'Администратор' },
  { key: 'HEAD', label: 'Руководитель' },
  { key: 'MANAGER', label: 'Менеджер' },
  { key: 'ANALYST', label: 'Аналитик' },
  { key: 'VIEWER', label: 'Наблюдатель' },
  { key: 'UNIVERSITY_REP', label: 'Представитель вуза' },
  { key: 'REVIEWER', label: 'Эксперт' },
] as const

export { HELP_GROUPS, HELP_TOPICS, HELP_TOPIC_IDS, docsHref, helpAnchor, helpHref } from './topics'
export type { HelpGroupId, HelpTopicId, HelpTopicSummary } from './topics'
export { HELP_TOOLS, helpEntry } from './tools'
export type { HelpEntry, HelpRef, HelpToolKey, HelpToolSummary, HelpToolTopic } from './tools'
export type {
  HelpFaq,
  HelpRightsRow,
  HelpRoleColumn,
  HelpSection,
  HelpTerm,
  HelpToolSection,
  HelpTopicBody,
  HelpWhere,
} from './types'
export { HELP_TERMS } from './terms'
