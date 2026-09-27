import type { CooperationForecastDto, ForecastMilestoneDto } from '@/shared/contracts'
import { SIGNING_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { pluralize } from '@/ui/lib/format'

/**
 * Подача прогноза связки человеку (решение 211): заголовок-вопрос, шансы
 * словами, одна строка «как считаем» и пояснение «?». Технические слова
 * (модель, ворота, правило) — только в «Подробнее для аналитика».
 * Здесь — только чистые функции: их проверяет тест.
 */

/** Цель вехи в заголовке: «до договора», «до начала занятий». */
export function milestoneGoal(milestone: ForecastMilestoneDto): string {
  if (milestone.stageNumber === SIGNING_STAGE_NUMBER) return 'до договора'
  if (milestone.stageNumber === 11) return 'до начала занятий'
  return `до этапа ${milestone.stageNumber} «${milestone.stageTitle}»`
}

function daysText(days: number): string {
  return `${days} ${pluralize(days, ['день', 'дня', 'дней'])}`
}

/** «Шансы дойти до договора за 60 дней». */
export function forecastHeadline(milestone: ForecastMilestoneDto, horizonDays: number | null): string {
  const goal = milestoneGoal(milestone)
  return horizonDays === null ? `Шансы дойти ${goal}` : `Шансы дойти ${goal} за ${daysText(horizonDays)}`
}

export type ChanceLevel = 'high' | 'medium' | 'low'

/**
 * Границы слов «высокие / средние / низкие». Подача, а не расчёт: число
 * рядом всегда видно, слово только помогает прочесть его с первого взгляда.
 */
const HIGH_FROM = 0.65 // TEMP
const MEDIUM_FROM = 0.35 // TEMP

export function chanceLevel(probability: number): ChanceLevel {
  if (probability >= HIGH_FROM) return 'high'
  if (probability >= MEDIUM_FROM) return 'medium'
  return 'low'
}

export const CHANCE_WORDS: Record<ChanceLevel, string> = {
  high: 'Высокие',
  medium: 'Средние',
  low: 'Низкие',
}

/** Одна строка «как считаем» — по тому, откуда число на самом деле. */
export function howWeCount(source: CooperationForecastDto['source']): string {
  return source === 'model'
    ? 'По истории похожих связок: встречи, дни без активности, время на этапе.'
    : 'По тому, как часто связки на этом этапе доходили до цели.'
}

/** Пояснение «?»: что это, откуда цифра, что делать — три абзаца (пузырь подсказки переносит по `\n`). */
export function forecastHelp(forecast: CooperationForecastDto, level: ChanceLevel): string {
  const goal = forecast.milestone ? milestoneGoal(forecast.milestone) : 'до следующей важной точки'
  const horizon = forecast.horizonDays === null ? '' : ` за ${daysText(forecast.horizonDays)}`
  const what = `Что это: насколько вероятно, что связка дойдёт ${goal}${horizon}.`
  const from =
    forecast.source === 'model'
      ? '\nОткуда цифра: система сравнила эту связку с прошлыми — сколько было встреч, сколько дней без движения, как долго она на этапе — и посмотрела, чем закончились похожие.'
      : '\nОткуда цифра: из прошлых случаев, когда связка стояла на том же этапе, — какая доля дошла до цели за этот срок. Для всех связок на этом этапе цифра одна.'
  const todo =
    level === 'low'
      ? forecast.source === 'model'
        ? '\nЧто делать: шансы низкие — чаще всего помогают встреча с вузом, закрытые пункты текущего этапа и документы, отправленные на согласование. Ниже видно, что тянет вниз именно эту связку.'
        : '\nЧто делать: шансы низкие — цифра вырастет, когда связка перейдёт на следующий этап. Закройте пункты текущего этапа и договоритесь о встрече с вузом.'
      : '\nЧто делать: держать темп — не допускать долгих пауз без встреч и вовремя закрывать этапы.'
  return what + from + todo
}

/** Пустое состояние: без слов «модель» и «веха». */
export function forecastEmpty(forecast: CooperationForecastDto): { title: string; description: string } {
  switch (forecast.status) {
    case 'reached':
      return { title: 'Договор и начало занятий уже позади', description: 'Все ключевые точки пройдены — оценивать больше нечего.' }
    case 'not_applicable':
      return { title: 'Прогноз не нужен', description: 'Связка закрыта или у неё нет текущего этапа.' }
    default:
      return {
        title: 'Шансы пока не посчитать',
        description: 'В истории ещё мало связок, прошедших этот путь, — оценке не на чем основаться.',
      }
  }
}
