import { describe, expect, it } from 'vitest'
import type { ProblemCooperationDto, ProblemGroupsDto, ProblemSeverity } from '@/shared/contracts'
import { attentionGroupLabel, attentionGroups, attentionHidden, attentionSummary } from './attention-queue'

function row(id: string, severity: ProblemSeverity, daysOverdue: number | null = 10): ProblemCooperationDto {
  return {
    cooperationId: id,
    universityName: `Вуз ${id}`,
    universityShortName: id,
    programName: 'Программная инженерия',
    reason: '',
    stageId: `stage-${id}`,
    stageNumber: 6,
    stageTitle: 'Подписание документов',
    daysOverdue: severity === 'blocked' ? null : daysOverdue,
    severity,
    deadline: null,
    blockingReason: severity === 'blocked' ? 'Нет подписи' : null,
    responsible: null,
  }
}

/** Как на стенде 27.09: 13 этапов — 3 давних, 4 свежих, 6 блокировок; показаны 10 самых давних. */
const GROUPS: ProblemGroupsDto = { overdueLong: 3, overdue: 4, blocked: 6, longOverdueDays: 30 }
const SHOWN = [
  row('ДГТУ', 'overdue-long', 101),
  row('СПбГУТ', 'overdue-long', 57),
  row('КАИ', 'overdue-long', 39),
  row('МТУСИ', 'overdue', 15),
  row('ПГУТИ', 'overdue', 5),
  row('УУНиТ', 'overdue', 4),
  row('ВГУ', 'overdue', 3),
  row('КАИ-2', 'blocked'),
  row('МТУСИ-2', 'blocked'),
  row('НГТУ', 'blocked'),
]

describe('«Требует внимания»: группы по серьёзности', () => {
  it('три группы в порядке серьёзности, числа — по всем этапам, строки — показанные', () => {
    const groups = attentionGroups(SHOWN, GROUPS)
    expect(groups.map((group) => [group.label, group.count, group.rows.length])).toEqual([
      ['Просрочены больше месяца', 3, 3],
      ['Просрочены до месяца', 4, 4],
      ['Заблокированы', 6, 3],
    ])
  })

  it('порядок строк внутри группы — как с сервера (по сроку)', () => {
    const [long] = attentionGroups(SHOWN, GROUPS)
    expect(long!.rows.map((item) => item.universityShortName)).toEqual(['ДГТУ', 'СПбГУТ', 'КАИ'])
  })

  it('группа без показанных строк не рисуется', () => {
    const groups = attentionGroups([row('А', 'overdue')], { overdueLong: 0, overdue: 1, blocked: 5, longOverdueDays: 30 })
    expect(groups.map((group) => group.key)).toEqual(['overdue'])
  })

  it('подпись группы следует порогу из конфига: 30 дней — «месяц», другой — числом', () => {
    expect(attentionGroupLabel('overdue-long', 30)).toBe('Просрочены больше месяца')
    expect(attentionGroupLabel('overdue', 30)).toBe('Просрочены до месяца')
    expect(attentionGroupLabel('overdue-long', 14)).toBe('Просрочены больше 14 дней')
    expect(attentionGroupLabel('overdue', 21)).toBe('Просрочены до 21 дня')
  })

  it('описание блока — одна база с группами: «13 этапов стоят: 7 просрочены, 6 заблокированы»', () => {
    expect(attentionSummary(13, GROUPS)).toBe('13 этапов стоят: 7 просрочены, 6 заблокированы.')
    expect(attentionSummary(1, { overdueLong: 0, overdue: 1, blocked: 0, longOverdueDays: 30 })).toBe(
      '1 этап стоит: 1 просрочен.',
    )
    expect(attentionSummary(0, { overdueLong: 0, overdue: 0, blocked: 0, longOverdueDays: 30 })).toBe(
      'Просроченных и заблокированных этапов нет.',
    )
  })
})

describe('«Требует внимания»: подвал с невошедшими', () => {
  it('не вошли только блокировки — ссылка на реестр с фильтром «заблокированные»', () => {
    expect(attentionHidden(SHOWN, GROUPS)).toEqual({
      text: 'Ещё 3 заблокированных',
      href: '/cooperations?onlyBlocked=true',
    })
  })

  it('не вошли только просрочки — фильтр «просроченные»', () => {
    const groups = { ...GROUPS, blocked: 3 }
    const shown = SHOWN.filter((item) => item.severity !== 'overdue').concat(row('X', 'overdue'))
    expect(attentionHidden(shown, groups)?.href).toBe('/cooperations?onlyOverdue=true')
    expect(attentionHidden(shown, groups)?.text).toBe('Ещё 3 просроченных')
  })

  it('не вошли и те и другие — реестр без фильтра и разбивка', () => {
    const hidden = attentionHidden(SHOWN.slice(0, 5), GROUPS)
    expect(hidden).toEqual({ text: 'Ещё 8: 2 просрочены, 6 заблокированы', href: '/cooperations' })
  })

  it('показано всё — подвала нет', () => {
    expect(attentionHidden(SHOWN, { overdueLong: 3, overdue: 4, blocked: 3, longOverdueDays: 30 })).toBeNull()
  })
})
