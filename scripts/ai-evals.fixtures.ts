/**
 * Фикстуры офлайн-экзамена помощника (решение 138, scripts/ai-evals.ts).
 *
 * Связки в разных состояниях — не из базы: правила и шаблон проверяются сами
 * по себе, без сети и без сида. Ни в одном факте нет настоящих персональных
 * данных: экзамен проверяет, что помощник не вносит их сам, а не то, что он
 * умеет их скрывать (это отдельно — ai-story.masking.test.ts).
 */
import type { CooperationStoryFacts } from '../src/modules/ai-assist/ai-story.rules'

export interface StoryFixture {
  name: string
  facts: CooperationStoryFacts
}

const BASE = {
  universityName: 'Санкт-Петербургский государственный университет телекоммуникаций',
  universityShortName: 'СПбГУТ',
  programName: 'Программная инженерия',
  productName: 'Курс «Основы разработки»',
  documents: { signed: 0, total: 0 },
  meetings: { total: 2, lastAt: '2026-08-20T10:00:00.000Z' },
  openRecommendations: 1,
  classesStartAt: '2026-09-01T00:00:00.000Z',
} satisfies Partial<CooperationStoryFacts>

export const STORY_FIXTURES: StoryFixture[] = [
  {
    name: 'ранний этап, без препятствий',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-2', stageNumber: 2, title: 'Связь и подтверждение актуальности IT-программ', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 1,
      mainBlocker: null,
    },
  },
  {
    name: 'этап заблокирован',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-4', stageNumber: 4, title: 'Обмен документами', status: 'BLOCKED' },
      totalStages: 13,
      closedStages: 3,
      mainBlocker: {
        code: 'STAGE_BLOCKED',
        detail: 'Этап 4 «Обмен документами» заблокирован: ждём юридическое заключение',
        link: '/cooperations/c1/stages/stage-4',
        stageNumber: 4,
      },
    },
  },
  {
    name: 'ждёт контрольную точку',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-7', stageNumber: 7, title: 'Передача учебных материалов, лицензии и документации', status: 'NOT_STARTED' },
      totalStages: 13,
      closedStages: 5,
      mainBlocker: {
        code: 'CONTROL_POINT',
        detail: 'Этап 7 «Передача учебных материалов, лицензии и документации» ждёт контрольную точку: не закрыты 6 «Подписание документов»',
        link: '/cooperations/c1/stages/stage-7',
        stageNumber: 7,
      },
    },
  },
  {
    name: 'продукт не выбран',
    facts: {
      ...BASE,
      productName: null,
      status: 'ACTIVE',
      current: { id: 'stage-5', stageNumber: 5, title: 'Доработка документов при необходимости', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 4,
      mainBlocker: {
        code: 'PRODUCT_NOT_SELECTED',
        detail: 'Связка дошла до этапа 5, а IT-продукт ещё не выбран',
        link: '/cooperations/c1',
        stageNumber: 5,
      },
    },
  },
  {
    name: 'документы не подписаны',
    facts: {
      ...BASE,
      documents: { signed: 0, total: 2 },
      status: 'ACTIVE',
      current: { id: 'stage-6', stageNumber: 6, title: 'Подписание документов', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 5,
      mainBlocker: {
        code: 'DOCUMENTS_NOT_SIGNED',
        detail: 'Этап подписания документов, а подписанных документов пока нет',
        link: '/cooperations/c1/documents',
        stageNumber: 6,
      },
    },
  },
  {
    name: 'ждём вуз',
    facts: {
      ...BASE,
      documents: { signed: 2, total: 2 },
      status: 'ACTIVE',
      current: { id: 'stage-7b', stageNumber: 7, title: 'Передача учебных материалов, лицензии и документации', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 6,
      mainBlocker: {
        code: 'UNIVERSITY_ITEM_PENDING',
        detail: 'Ждём вуз: пункт «Вуз подтвердил получение материалов» отмечает представитель вуза в кабинете',
        link: '/cooperations/c1/stages/stage-7b',
        stageNumber: 7,
      },
    },
  },
  {
    name: 'не закрыты пункты чек-листа',
    facts: {
      ...BASE,
      documents: { signed: 2, total: 2 },
      status: 'ACTIVE',
      current: { id: 'stage-8', stageNumber: 8, title: 'Поддержка внедрения IT-продукта', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 7,
      mainBlocker: {
        code: 'REQUIRED_TASKS_OPEN',
        detail: 'Не закрыты обязательные пункты чек-листа этапа 8: 1 из 2',
        link: '/cooperations/c1/stages/stage-8',
        stageNumber: 8,
      },
    },
  },
  {
    name: 'этап не начат',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-3', stageNumber: 3, title: 'Организация встречи', status: 'NOT_STARTED' },
      totalStages: 13,
      closedStages: 2,
      mainBlocker: {
        code: 'STAGE_NOT_STARTED',
        detail: 'Этап 3 «Организация встречи» ещё не начат',
        link: '/cooperations/c1/stages/stage-3',
        stageNumber: 3,
      },
    },
  },
  {
    name: 'не записан результат',
    facts: {
      ...BASE,
      documents: { signed: 2, total: 2 },
      status: 'ACTIVE',
      current: { id: 'stage-9', stageNumber: 9, title: 'Обучение преподавателей', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 8,
      mainBlocker: {
        code: 'RESULT_MISSING',
        detail: 'Пункты этапа 9 закрыты, а результат ещё не записан',
        link: '/cooperations/c1/stages/stage-9',
        stageNumber: 9,
      },
    },
  },
  {
    name: 'впереди контрольная точка',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-5b', stageNumber: 5, title: 'Доработка документов при необходимости', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 4,
      mainBlocker: {
        code: 'NEXT_CONTROL_POINT',
        detail: 'Следующий этап 6 «Подписание документов» — контрольная точка: перед ним нужно закрыть ещё 4 «Обмен документами»',
        link: '/cooperations/c1/stages/stage-6',
        stageNumber: 6,
      },
    },
  },
  {
    name: 'связка приостановлена',
    facts: {
      ...BASE,
      status: 'PAUSED',
      current: { id: 'stage-4b', stageNumber: 4, title: 'Обмен документами', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 3,
      mainBlocker: {
        code: 'COOPERATION_PAUSED',
        detail: 'Связка приостановлена: возобновите её, чтобы продолжить работу по этапам',
        link: '/cooperations/c1',
        stageNumber: null,
      },
    },
  },
  {
    name: 'связка завершена',
    facts: {
      ...BASE,
      status: 'COMPLETED',
      current: null,
      totalStages: 13,
      closedStages: 13,
      openRecommendations: 0,
      mainBlocker: {
        code: 'COOPERATION_CLOSED',
        detail: 'Связка в статусе «Завершена»: этапы не ведутся',
        link: '/cooperations/c1',
        stageNumber: null,
      },
    },
  },
  {
    name: 'связка отменена, встреч не было',
    facts: {
      ...BASE,
      status: 'CANCELLED',
      current: null,
      totalStages: 13,
      closedStages: 13,
      meetings: { total: 0, lastAt: null },
      openRecommendations: 0,
      classesStartAt: null,
      mainBlocker: {
        code: 'COOPERATION_CLOSED',
        detail: 'Связка в статусе «Отменена»: этапы не ведутся',
        link: '/cooperations/c1',
        stageNumber: null,
      },
    },
  },
  {
    name: 'много встреч и рекомендаций, дата начала не указана',
    facts: {
      ...BASE,
      status: 'ACTIVE',
      current: { id: 'stage-10', stageNumber: 10, title: 'Обновление образовательной программы', status: 'IN_PROGRESS' },
      totalStages: 13,
      closedStages: 9,
      meetings: { total: 9, lastAt: '2026-09-15T12:00:00.000Z' },
      openRecommendations: 12,
      classesStartAt: null,
      mainBlocker: null,
    },
  },
]
