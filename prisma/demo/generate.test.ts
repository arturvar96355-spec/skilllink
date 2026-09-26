import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { ANONYMIZED_CONTACT_NAME } from '@/modules/universities/universities.rules'
import { skillNameKey } from '@/modules/skills/skills.rules'
import { EXTRA_MARKET, EXTRA_PRODUCTS, EXTRA_PROGRAMS, EXTRA_SKILLS, MORE_SKILLS } from './catalog'
import { buildStageTimeline, DAY_MS, DEFAULT_STABLE_UNTIL, generateDemoData, type DemoData } from './generate'
import { fnv1a, mulberry32 } from './random'
import {
  activityDates,
  dailyCounts,
  detectAnomaly,
  kaplanMeier,
  kmSufficiency,
  meetingDates,
  newCooperationDates,
  stageObservations,
  transitionDates,
  type Observation,
} from './stats'

/** Заливка перед экспертизой: вторник, 29.09.2026, 12:00 МСК. */
const ANCHOR = new Date('2026-09-29T09:00:00.000Z')
const data = generateDemoData({ anchor: ANCHOR, stableUntil: DEFAULT_STABLE_UNTIL })

const hashOf = (value: DemoData) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Разрешённые переходы статуса этапа (решение 3), без переоткрытия. */
const ALLOWED: Record<string, readonly string[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
}

describe('ГПСЧ', () => {
  it('mulberry32 с одним зерном даёт одну последовательность', () => {
    const a = mulberry32(fnv1a('СФУ'))
    const b = mulberry32(fnv1a('СФУ'))
    const first = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(first)
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true)
  })

  it('FNV-1a: известное значение пустой строки и разные строки — разные хеши', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('unn')).not.toBe(fnv1a('unm'))
  })
})

describe('детерминизм генератора', () => {
  it('два прогона с одной якорной датой — один и тот же набор', () => {
    const again = generateDemoData({ anchor: new Date(ANCHOR), stableUntil: DEFAULT_STABLE_UNTIL })
    expect(hashOf(again)).toBe(hashOf(data))
  })

  it('другая якорная дата меняет даты, но не состав', () => {
    const later = generateDemoData({ anchor: new Date(ANCHOR.getTime() + 3 * DAY_MS), stableUntil: DEFAULT_STABLE_UNTIL })
    expect(hashOf(later)).not.toBe(hashOf(data))
    expect(later.cooperations.map((coop) => [coop.key, coop.status, coop.currentStage])).toEqual(
      data.cooperations.map((coop) => [coop.key, coop.status, coop.currentStage]),
    )
  })
})

describe('объёмы и покрытие статусов', () => {
  it('63 связки, 12 вузов, 8 продуктов, программы по 2–6 на вуз (решение 141)', () => {
    expect(data.cooperations).toHaveLength(63)
    expect(data.universities).toHaveLength(12)
    expect(data.products).toHaveLength(8)
    for (const university of data.universities) {
      const count = data.programs.filter((program) => program.universityKey === university.key).length
      expect(count, university.key).toBeGreaterThanOrEqual(2)
      expect(count, university.key).toBeLessThanOrEqual(6)
    }
  })

  it('связки на всех 14 этапах и во всех статусах', () => {
    const stages = new Set(data.cooperations.map((coop) => coop.currentStage))
    expect([...stages].sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, index) => index + 1))
    const statuses = new Set(data.cooperations.map((coop) => coop.status))
    expect([...statuses].sort()).toEqual(['ACTIVE', 'CANCELLED', 'COMPLETED', 'DRAFT', 'PAUSED'])
  })

  it('документы во всех статусах, встречи прошлые, будущие и заочные', () => {
    const documentStatuses = new Set(data.cooperations.flatMap((coop) => coop.documents.map((document) => document.status)))
    expect([...documentStatuses].sort()).toEqual(['APPROVED', 'ARCHIVED', 'DRAFT', 'REJECTED', 'REVIEW', 'SIGNED'])
    const meetings = data.cooperations.flatMap((coop) => coop.meetings)
    expect(meetings.some((meeting) => meeting.date > ANCHOR)).toBe(true)
    expect(meetings.some((meeting) => meeting.date <= ANCHOR)).toBe(true)
    expect(meetings.some((meeting) => meeting.format === 'CORRESPONDENCE')).toBe(true)
  })

  it('этапы во всех статусах, есть заблокированные и отменённые', () => {
    const statuses = new Set(data.cooperations.flatMap((coop) => coop.stages.map((stage) => stage.status)))
    expect([...statuses].sort()).toEqual(['BLOCKED', 'CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'NOT_STARTED'])
  })

  it('закрытые рекомендации прошлого — выполненные и отклонённые', () => {
    const statuses = new Set(data.resolvedRecommendations.map((row) => row.status))
    expect([...statuses].sort()).toEqual(['DISMISSED', 'DONE'])
    // В ленте «по важности» закрытые не встают среди открытых критичных (решение 101).
    expect(data.resolvedRecommendations.every((row) => row.priority !== 'CRITICAL' && row.priority !== 'HIGH')).toBe(true)
  })
})

describe('инварианты связок', () => {
  it.each(data.cooperations.map((coop) => [coop.key, coop] as const))('%s: история этапов монотонна и кончается текущим этапом', (_, coop) => {
    const timeline = buildStageTimeline(coop)
    expect(timeline.length).toBeGreaterThan(0)
    for (let index = 0; index < timeline.length; index += 1) {
      const entry = timeline[index]!
      if (entry.leftAt) expect(entry.leftAt.getTime()).toBeGreaterThanOrEqual(entry.enteredAt.getTime())
      const next = timeline[index + 1]
      if (!next) continue
      expect(next.stage).toBeGreaterThan(entry.stage)
      expect(entry.leftAt).not.toBeNull()
      expect(next.enteredAt.getTime()).toBeGreaterThanOrEqual(entry.leftAt!.getTime())
    }
    const last = timeline[timeline.length - 1]!
    if (coop.status === 'COMPLETED') {
      expect(last.stage).toBe(14)
    } else if (coop.idle) {
      expect(last.stage).toBe(coop.currentStage - 1)
      expect(last.leftAt).not.toBeNull()
    } else if (coop.status === 'CANCELLED') {
      expect(last.stage).toBe(coop.currentStage)
      expect(last.leftAt?.getTime()).toBe(coop.closedAt?.getTime())
    } else {
      expect(last.stage).toBe(coop.currentStage)
      expect(last.leftAt).toBeNull()
    }
    expect(timeline[0]!.enteredAt.getTime()).toBe(coop.startedAt.getTime())
    expect(ANCHOR.getTime() - coop.startedAt.getTime()).toBeLessThan(290 * DAY_MS)
  })

  it.each(data.cooperations.map((coop) => [coop.key, coop] as const))('%s: статусы, история и пункты этапов согласованы', (_, coop) => {
    expect(coop.stages).toHaveLength(14)
    const control = coop.stages[13]!
    expect(control.status).toBe(computeControlStatus(coop.stages.slice(0, 13).map((stage) => stage.status)))
    for (const stage of coop.stages) {
      // История: время не убывает, переходы разрешены, последняя запись — текущий статус.
      let previous: Date | null = null
      for (const entry of stage.history) {
        if (previous) expect(entry.changedAt.getTime()).toBeGreaterThanOrEqual(previous.getTime())
        previous = entry.changedAt
        expect(ALLOWED[entry.fromStatus ?? 'NOT_STARTED'], `${stage.number}: ${entry.fromStatus}→${entry.toStatus}`).toContain(entry.toStatus)
        expect(entry.changedAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime())
      }
      if (stage.status === 'NOT_STARTED') expect(stage.history).toHaveLength(0)
      else expect(stage.history.at(-1)?.toStatus).toBe(stage.status)

      expect(stage.status === 'COMPLETED').toBe(stage.completedAt !== null)
      if (stage.status === 'BLOCKED') expect(stage.blockingReason).toBeTruthy()
      if (stage.status === 'COMPLETED' && stage.number !== 14) {
        expect(stage.result).toBeTruthy()
        expect(stage.tasks.filter((task) => task.isRequired).every((task) => task.isDone)).toBe(true)
      }
      for (const task of stage.tasks) {
        expect(task.isDone).toBe(task.doneAt !== null)
        if (task.doneAt) {
          expect(task.doneAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime())
          expect(task.doneAt.getTime()).toBeGreaterThanOrEqual(stage.startedAt!.getTime())
        }
        // Пункт вуза без представителя — только с пометкой, чем подтверждён (решение 103).
        expect(task.confirmationNote !== null).toBe(task.isDone && task.isUniversityItem)
      }
    }
  })

  it.each(data.cooperations.map((coop) => [coop.key, coop] as const))('%s: сроки не «протухают» до конца экспертизы', (_, coop) => {
    const open = coop.status === 'ACTIVE' || coop.status === 'DRAFT' || coop.status === 'PAUSED'
    if (!open) return
    for (const stage of coop.stages) {
      if (stage.status === 'COMPLETED' || stage.status === 'CANCELLED') continue
      const deadline = stage.deadline.getTime()
      // Прошедший срок так и остаётся прошедшим; будущий — за окном стабильности.
      const past = deadline < ANCHOR.getTime()
      expect(past || deadline > DEFAULT_STABLE_UNTIL.getTime(), `этап ${stage.number}`).toBe(true)
      if (past && stage.status === 'IN_PROGRESS') {
        // Просрочка до недели: приоритет «средний», сценарий показа не сдвигается.
        expect(ANCHOR.getTime() - deadline).toBeLessThan(7 * DAY_MS)
      }
      if (stage.status === 'BLOCKED') expect(past).toBe(false)
    }
  })

  it.each(data.cooperations.map((coop) => [coop.key, coop] as const))('%s: даты встреч согласованы со статусами', (_, coop) => {
    for (const meeting of coop.meetings) {
      expect(meeting.date.getTime()).toBeGreaterThanOrEqual(coop.startedAt.getTime())
      if (meeting.date > ANCHOR) {
        // Будущая: итога нет, связка открыта, до конца экспертизы остаётся будущей.
        expect(meeting.result).toBeNull()
        expect(['ACTIVE', 'DRAFT', 'PAUSED']).toContain(coop.status)
        expect(meeting.date.getTime()).toBeGreaterThan(DEFAULT_STABLE_UNTIL.getTime())
        expect(meeting.createdAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime())
      } else {
        expect(meeting.result).toBeTruthy()
        if (coop.closedAt) expect(meeting.date.getTime()).toBeLessThanOrEqual(coop.closedAt.getTime())
      }
      if (meeting.nextActionDueAt && meeting.nextActionDueAt > ANCHOR) {
        expect(meeting.nextActionDueAt.getTime()).toBeGreaterThan(DEFAULT_STABLE_UNTIL.getTime())
      }
      expect(meeting.participants.filter((participant) => participant.kind === 'responsible')).toHaveLength(1)
    }
  })

  it.each(data.cooperations.map((coop) => [coop.key, coop] as const))('%s: документы согласованы с этапами', (_, coop) => {
    for (const document of coop.documents) {
      const history = document.history
      for (let index = 1; index < history.length; index += 1) {
        expect(history[index]!.changedAt.getTime()).toBeGreaterThanOrEqual(history[index - 1]!.changedAt.getTime())
        expect(history[index]!.fromStatus).toBe(history[index - 1]!.toStatus)
      }
      expect(history.at(-1)?.toStatus ?? 'DRAFT').toBe(document.status)
      expect(document.status === 'SIGNED').toBe(document.signedAt !== null)
      expect(document.updatedAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime())
    }
    // Подписанный договор закрывает этап 6 (решение 87) — и только он.
    const agreements = coop.documents.filter((document) => document.type === 'AGREEMENT')
    const stage6Done = coop.stages[5]!.status === 'COMPLETED'
    expect(agreements.some((document) => document.status === 'SIGNED')).toBe(stage6Done)
    if (stage6Done) {
      expect(agreements.every((document) => ['SIGNED', 'REJECTED', 'ARCHIVED'].includes(document.status))).toBe(true)
    }
  })
})

describe('справочники', () => {
  const q2 = Object.keys(EXTRA_MARKET['2026-Q2']!)
  const extraNames = EXTRA_SKILLS.map((skill) => skill.name)

  it('навыки без дублей по ключу названия (решение 110)', () => {
    const keys = q2.map(skillNameKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const name of extraNames) expect(q2).toContain(name)
    for (const name of MORE_SKILLS.map((skill) => skill.name)) expect(q2).toContain(name)
    expect(q2.length).toBe(50)
  })

  it('программы и продукты ссылаются только на навыки справочника', () => {
    const names = new Set(q2)
    for (const program of EXTRA_PROGRAMS) for (const [name] of program.skills) expect(names.has(name), `${program.key}: ${name}`).toBe(true)
    for (const product of EXTRA_PRODUCTS) for (const [name] of product.skills) expect(names.has(name), `${product.key}: ${name}`).toBe(true)
  })

  it('дефициты сценария показа не закрыты ни одной новой программой', () => {
    for (const program of EXTRA_PROGRAMS) {
      for (const [name] of program.skills) expect(['Kubernetes', 'PostgreSQL', 'MLOps']).not.toContain(name)
    }
  })

  it('показатели программ не выше максимумов основного сида: баллы вузов сценария не сдвигаются', () => {
    for (const program of EXTRA_PROGRAMS) {
      expect(program.applicationCount ?? 0).toBeLessThanOrEqual(420)
      expect(program.studentCount ?? 0).toBeLessThanOrEqual(180)
      expect(program.groupCount ?? 0).toBeLessThanOrEqual(7)
    }
  })

  it('заявки на обучение складываются в показатель программы', () => {
    for (const program of data.programs) {
      const counted = program.applications
        .filter((application) => ['NEW', 'CONFIRMED', 'ENROLLED'].includes(application.status))
        .reduce((sum, application) => sum + application.quantity, 0)
      expect(counted, program.key).toBe(program.applicationCount ?? 0)
    }
  })

  it('контакты без реальных данных: вымышленные ящики, тестовые телефоны, отзыв — обезличен', () => {
    const contacts = data.universities.flatMap((university) => university.contacts)
    const bases = new Set(contacts.map((contact) => contact.legalBasis))
    expect(bases).toEqual(new Set(['LEGITIMATE_INTEREST', 'CONSENT', null]))
    for (const contact of contacts) {
      if (contact.email) expect(contact.email).toMatch(/@[a-z]+\.example\.invalid$/)
      if (contact.phone) expect(contact.phone).toMatch(/^\+7 900 000-00-\d\d$/)
      if (contact.consentStatus === 'WITHDRAWN') {
        expect(contact.fullName).toBe(ANONYMIZED_CONTACT_NAME)
        expect([contact.email, contact.phone, contact.position]).toEqual([null, null, null])
      }
    }
    expect(contacts.some((contact) => contact.consentStatus === 'WITHDRAWN')).toBe(true)
  })
})

describe('калькулятор: хватает ли данных аналитике этапов', () => {
  it('Каплан — Мейер: данных хватает минимум на 5 этапов (≥30 наблюдений, ≥15 событий)', () => {
    const rows = kmSufficiency(stageObservations(data.cooperations, ANCHOR))
    const enough = rows.filter((row) => row.enough).map((row) => row.stage)
    expect(enough.length).toBeGreaterThanOrEqual(5)
    expect(enough).toEqual(expect.arrayContaining([1, 2, 3, 4, 6]))
  })

  it('«застревающие» вузы: этап 6 у них идёт в 3+ раза дольше обычного', () => {
    const stage6 = (pattern: 'stuck' | 'other'): Observation[] =>
      data.cooperations
        .filter((coop) => (coop.pattern === 'stuck') === (pattern === 'stuck'))
        .flatMap((coop) => coop.stages.filter((stage) => stage.number === 6 && stage.startedAt))
        .map((stage) => ({
          duration: ((stage.completedAt ?? stage.endedAt ?? ANCHOR).getTime() - stage.startedAt!.getTime()) / DAY_MS,
          event: stage.status === 'COMPLETED',
        }))
    const regular = kaplanMeier(stage6('other')).median
    expect(regular).not.toBeNull()
    const stuck = stage6('stuck').map((item) => item.duration).sort((a, b) => a - b)
    const stuckMedian = stuck[Math.floor(stuck.length / 2)]!
    // Незавершённые у «застревающих» — нижняя граница: реальная медиана ещё больше.
    expect(stuckMedian).toBeGreaterThanOrEqual(3 * regular!)
  })

  it('«уходящий» вуз: активности нет полтора месяца', () => {
    const fading = data.cooperations.filter((coop) => coop.pattern === 'fading')
    expect(fading.length).toBeGreaterThanOrEqual(3)
    const last = Math.max(
      ...fading.flatMap((coop) => activityDates([coop], ANCHOR).map((date) => date.getTime())),
    )
    expect(ANCHOR.getTime() - last).toBeGreaterThan(45 * DAY_MS)
  })

  it('сезонность: в августе встреч заметно меньше, чем в июле и сентябре', () => {
    const byMonth = new Map<number, number>()
    for (const meeting of data.cooperations.flatMap((coop) => coop.meetings)) {
      if (meeting.date > ANCHOR) continue
      const month = meeting.date.getUTCMonth()
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
    }
    expect(byMonth.get(7)!).toBeLessThan(0.6 * byMonth.get(6)!)
  })

  // Всплеск держится на последней неделе при любом дне заливки: ряд «Встречи»,
  // как его строит «Система заметила» (решение 120).
  it.each([0, 1, 2, 3, 4, 5, 6])('всплеск спроса на киберполигон ловится детектором (заливка +%i дн.)', (shift) => {
    const anchor = new Date(ANCHOR.getTime() + shift * DAY_MS)
    const shifted = generateDemoData({ anchor, stableUntil: DEFAULT_STABLE_UNTIL })
    const result = detectAnomaly(dailyCounts(meetingDates(shifted, anchor), anchor, 60))
    expect(result).not.toBeNull()
    expect(result!.isAnomaly, JSON.stringify(result)).toBe(true)
    expect(result!.z).toBeGreaterThan(2.5)
    // Остальные ряды выброса не дают: «Система заметила» говорит об одном — о спросе.
    expect(detectAnomaly(dailyCounts(transitionDates(shifted.cooperations), anchor, 60))!.isAnomaly).toBe(false)
    expect(detectAnomaly(dailyCounts(newCooperationDates(shifted.cooperations), anchor, 60))!.isAnomaly).toBe(false)
  })

  it('всплеск — встречи с вузами о киберполигоне за последние шесть дней', () => {
    expect(data.universityMeetings.length).toBeGreaterThanOrEqual(30)
    for (const meeting of data.universityMeetings) {
      expect(ANCHOR.getTime() - meeting.date.getTime()).toBeGreaterThan(0)
      expect(ANCHOR.getTime() - meeting.date.getTime()).toBeLessThan(7 * DAY_MS)
      expect(meeting.nextActionDueAt.getTime()).toBeGreaterThan(DEFAULT_STABLE_UNTIL.getTime())
      expect(meeting.universityKey).not.toBe('spbgu')
    }
  })

  it('детектор: ровный ряд — не аномалия, короткий ряд — не оценивается', () => {
    expect(detectAnomaly(new Array(35).fill(3))?.isAnomaly).toBe(false)
    expect(detectAnomaly(new Array(34).fill(3))).toBeNull()
    const spike = [...new Array(28).fill(1), ...new Array(7).fill(5)]
    expect(detectAnomaly(spike)?.isAnomaly).toBe(true)
    // Рост меньше 15 % — не аномалия даже при большом z.
    const small = [...new Array(28).fill(100), ...new Array(7).fill(110)]
    expect(detectAnomaly(small)?.isAnomaly).toBe(false)
  })

  it('окно стабильности: после конца экспертизы будущее не сдвигается', () => {
    const late = new Date('2026-11-02T09:00:00.000Z')
    const after = generateDemoData({ anchor: late, stableUntil: DEFAULT_STABLE_UNTIL })
    const future = after.cooperations.flatMap((coop) => coop.meetings).filter((meeting) => meeting.date > late)
    expect(future.length).toBeGreaterThan(0)
    expect(Math.min(...future.map((meeting) => meeting.date.getTime())) - late.getTime()).toBeLessThan(10 * DAY_MS)
  })
})
