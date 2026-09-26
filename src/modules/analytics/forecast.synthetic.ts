/**
 * Синтетическая история связок — ТОЛЬКО для тестов прогноза (решение 125).
 * В приложении и сиде не используется: это проверка, что модель находит
 * закономерность, которую мы сами заложили, и не находит её там, где её нет.
 *
 * Детерминированный генератор (mulberry32): одно зерно — одна история.
 *
 * Заложенная закономерность (`patternTimelines`):
 *   - у каждого вуза — своя вовлечённость (постоянная на всю историю связки): она
 *     решает, как часто бывают встречи, и держит частоту закрытия этапов — активная
 *     связка проходит все этапы быстрее вялой;
 *   - вдобавок этап закрывается быстрее, если по связке недавно что-то происходило:
 *     после 14 дней тишины шанс закрыть этап в день падает;
 *   - у трети вузов вовлечённость низкая («застревают») — это видно по редким
 *     встречам и долгой тишине, а не только по номеру этапа: должен найти признак
 *     «дней без активности», а не просто «правило по этапу».
 *
 * Шум (`noiseTimelines`): подписание наступает в случайный момент с постоянной
 * интенсивностью, не завися ни от чего; встречи и этапы 1–5 идут сами по себе.
 */

import type { ProgramLevel } from '@/shared/contracts/enums'
import { seededRandom } from './forecast-math'
import type { CooperationTimeline, StageEvent } from './forecast-features'

const DAY_MS = 24 * 60 * 60 * 1000
export const SYNTHETIC_NOW = new Date('2026-09-25T09:00:00.000Z')

const REGIONS = ['Москва', 'Санкт-Петербург', 'Республика Татарстан', 'Новосибирская область', 'Томская область']
const LEVELS: ProgramLevel[] = ['BACHELOR', 'BACHELOR', 'MASTER', 'SPECIALIST', 'SPO']

interface Options {
  seed: number
  cooperations: number
  universities: number
  /** За сколько дней до now начинается история. */
  historyDays: number
}

const DEFAULTS: Options = { seed: 20260925, cooperations: 90, universities: 12, historyDays: 300 }

const dayToDate = (day: number) => new Date(SYNTHETIC_NOW.getTime() + day * DAY_MS)

function skeleton(index: number, universityIndex: number, start: number, random: () => number): CooperationTimeline {
  return {
    id: `syn-${index}`,
    universityId: `uni-${universityIndex}`,
    region: REGIONS[universityIndex % REGIONS.length]!,
    programLevel: LEVELS[Math.floor(random() * LEVELS.length)]!,
    startedAt: dayToDate(start),
    closedAt: null,
    isMock: true,
    stageEvents: [{ stageNumber: 1, toStatus: 'IN_PROGRESS', at: dayToDate(start) }],
    tasks: [],
    meetings: [],
    documentEvents: [],
    dismissedRecommendations: [],
  }
}

function closeStage(
  timeline: CooperationTimeline,
  stage: number,
  day: number,
  random: () => number,
  openNext = true,
): void {
  const at = dayToDate(day)
  const events: StageEvent[] = [{ stageNumber: stage, toStatus: 'COMPLETED', at }]
  if (stage < 13 && openNext) events.push({ stageNumber: stage + 1, toStatus: 'IN_PROGRESS', at })
  timeline.stageEvents.push(...events)
  for (let task = 0; task < 2; task += 1) {
    timeline.tasks.push({ stageNumber: stage, doneAt: dayToDate(day - Math.floor(random() * 3)) })
  }
  if (stage === 3) timeline.documentEvents.push({ documentId: `${timeline.id}-agreement`, toStatus: 'REVIEW', at })
  if (stage === 6) timeline.documentEvents.push({ documentId: `${timeline.id}-agreement`, toStatus: 'SIGNED', at })
}

/** История с заложенной закономерностью «тишина тормозит связку». */
export function patternTimelines(options: Partial<Options> = {}): CooperationTimeline[] {
  const config = { ...DEFAULTS, ...options }
  const random = seededRandom(config.seed)
  const stuckUniversities = new Set(
    Array.from({ length: config.universities }, (_, i) => i).filter(() => random() < 0.33),
  )
  const timelines: CooperationTimeline[] = []

  for (let index = 0; index < config.cooperations; index += 1) {
    const universityIndex = Math.floor(random() * config.universities)
    const start = -Math.floor(20 + random() * (config.historyDays - 20))
    const timeline = skeleton(index, universityIndex, start, random)
    // Вовлечённость — постоянная у вуза черта, а не у отдельной связки: у «застревающих»
    // вузов она низкая на всём пути (мало встреч, долгая тишина), а не только на этапе 6.
    const stuck = stuckUniversities.has(universityIndex)
    const engagement = stuck ? random() * 0.15 : 0.3 + random() * 0.7
    // Бывают долгие периоды тишины: связка «засыпает» и «просыпается» — чаще у вялых.
    let asleep = false
    let lastActivity = start
    let stage = 1

    for (let day = start + 1; day <= 0 && stage <= 13; day += 1) {
      if (asleep ? random() < 0.02 + 0.02 * engagement : random() < 0.02 - 0.012 * engagement) {
        asleep = !asleep
      }
      if (!asleep && random() < 0.02 + 0.16 * engagement) {
        timeline.meetings.push(dayToDate(day))
        lastActivity = day
      }
      if (random() < 0.002) timeline.dismissedRecommendations.push(dayToDate(day))

      const quiet = day - lastActivity
      const chance = 0.1 * (quiet <= 10 ? 1.2 : 0.07) * (0.2 + 0.8 * engagement)
      if (random() < chance) {
        closeStage(timeline, stage, day, random)
        lastActivity = day
        stage += 1
      }
      if (quiet > 60 && random() < 0.01) {
        timeline.closedAt = dayToDate(day)
        break
      }
    }
    if (stage > 13 && timeline.closedAt === null) {
      const last = timeline.stageEvents[timeline.stageEvents.length - 1]!.at
      timeline.closedAt = last
    }
    timelines.push(timeline)
  }
  return timelines
}

/** Шум: подписание в случайный момент с постоянной интенсивностью, от признаков не зависит. */
export function noiseTimelines(options: Partial<Options> = {}): CooperationTimeline[] {
  const config = { ...DEFAULTS, seed: 7, ...options }
  const random = seededRandom(config.seed)
  const timelines: CooperationTimeline[] = []

  for (let index = 0; index < config.cooperations; index += 1) {
    const universityIndex = Math.floor(random() * config.universities)
    const start = -Math.floor(20 + random() * (config.historyDays - 20))
    const timeline = skeleton(index, universityIndex, start, random)
    let stage = 1
    let signed = false

    for (let day = start + 1; day <= 0; day += 1) {
      if (random() < 0.06) timeline.meetings.push(dayToDate(day))
      if (random() < 0.002) timeline.dismissedRecommendations.push(dayToDate(day))
      // Этапы 1–5 идут своим ходом и на подписание не влияют.
      if (stage <= 5 && random() < 0.05) {
        closeStage(timeline, stage, day, random, stage < 5)
        stage += 1
      }
      // Подписание — с постоянной интенсивностью 1/80 в день, вне зависимости от всего остального.
      if (!signed && random() < 1 / 80) {
        timeline.stageEvents.push({ stageNumber: 6, toStatus: 'COMPLETED', at: dayToDate(day) })
        signed = true
      }
    }
    timelines.push(timeline)
  }
  return timelines
}
