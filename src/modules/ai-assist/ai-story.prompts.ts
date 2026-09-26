import { AI_STORY } from '@/shared/config/ai-assist.config'
import type { Masker } from './ai-story.masking'
import {
  cooperationStoryLines,
  cooperationStoryTemplate,
  universityStoryLines,
  universityStoryTemplate,
  type CooperationStoryFacts,
  type UniversityStoryFacts,
} from './ai-story.rules'

/**
 * Промпты «Истории сотрудничества» (решение 138).
 *
 * В отличие от ИИ-помощника решения 90 (`ai-assist.prompts.ts`), где персональные
 * данные заменяются словом «ответственный» безвозвратно, здесь маскировка обратимая
 * (`ai-story.masking.ts`): в модель уходят метки `[КОНТАКТ_1]`, а после ответа —
 * то же место в тексте, но с настоящим значением. Факты и шаблон в ответе — исходные,
 * без меток: их видит только сотрудник, которому доступна «История сотрудничества»,
 * а он и так видит эти данные в карточке связки.
 */
export interface StoryPrompt {
  system: string
  user: string
  /** Факты как есть — в ответе и для проверки чисел в тексте модели. */
  facts: string[]
  /** Тот же текст без модели. */
  template: string
}

const COMMON_RULES = [
  'Ты помогаешь сотруднику ИТ-Школы РТК, которая работает с вузами.',
  'Пиши по-русски, деловым языком, коротко и без канцелярита, одним абзацем.',
  'Пиши только по фактам из сообщения. Не придумывай даты, сроки, числа, имена и названия, которых нет в фактах.',
  'В фактах бывают метки вида [КОНТАКТ_1], [СОТРУДНИК_2], [ПОЧТА_1], [ТЕЛЕФОН_1], [ЛИЦО_1] — ' +
    'переноси их в ответ ровно в таком виде, где они нужны по смыслу, не меняя и не убирая.',
  `Ответ — ровно от ${AI_STORY.minSentences} до ${AI_STORY.maxSentences} предложений, без списков и заголовков.`,
  'Не используй разметку Markdown: без звёздочек, решёток и таблиц.',
].join('\n')

function factsBlock(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

export function buildCooperationStoryPrompt(facts: CooperationStoryFacts, masker: Masker): StoryPrompt {
  const lines = cooperationStoryLines(facts)
  const maskedLines = lines.map((line) => masker.mask(line))
  return {
    system: [
      COMMON_RULES,
      'Составь историю сотрудничества по связке «вуз — программа — IT-продукт»: ' +
        'где связка сейчас, что мешает, что сделать дальше.',
    ].join('\n'),
    user: `Факты о связке:\n${factsBlock(maskedLines)}\n\nСоставь историю сотрудничества.`,
    facts: lines,
    template: cooperationStoryTemplate(facts),
  }
}

export function buildUniversityStoryPrompt(facts: UniversityStoryFacts, masker: Masker): StoryPrompt {
  const lines = universityStoryLines(facts)
  const maskedLines = lines.map((line) => masker.mask(line))
  return {
    system: [
      COMMON_RULES,
      'Составь историю сотрудничества с вузом в целом: сколько связок и в каком они ' +
        'состоянии, что мешает дальше всего продвинуться, что сделать дальше.',
    ].join('\n'),
    user: `Факты о вузе:\n${factsBlock(maskedLines)}\n\nСоставь историю сотрудничества.`,
    facts: lines,
    template: universityStoryTemplate(facts),
  }
}
