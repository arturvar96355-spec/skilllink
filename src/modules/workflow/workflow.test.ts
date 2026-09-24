import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import type { StageStatus } from '@/shared/contracts/enums'
import {
  isDueSoon,
  isControlPoint,
  findBlockingStages,
  assertChecklistReady,
  assertControlPointCancellable,
  assertControlPointReady,
  ALLOWED_TRANSITIONS,
  assertTasksEditable,
  assertTransition,
  computeControlStatus,
  computeProgressPercent,
  findCurrentStage,
  isAutoManaged,
  isLockedByControlPoint,
  isOverdue,
  resolveStageFields,
  assertStageFieldsComplete,
  historyComment,
  type StageState,
  type StageStatusFields,
} from './workflow.rules'

const stage = (overrides: Partial<StageState> = {}): StageState => ({
  stageNumber: 2,
  status: 'IN_PROGRESS',
  result: 'Результат зафиксирован',
  requiredTasksTotal: 0,
  requiredTasksDone: 0,
  ...overrides,
})

/** Проверяет, что вызов бросил AppError с ожидаемым кодом. */
function expectError(fn: () => void, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('таблица переходов', () => {
  it('разрешает переходы из решения 3', () => {
    expect(ALLOWED_TRANSITIONS.NOT_STARTED).toEqual(['IN_PROGRESS', 'CANCELLED'])
    expect(ALLOWED_TRANSITIONS.IN_PROGRESS).toEqual(['COMPLETED', 'BLOCKED', 'CANCELLED'])
    expect(ALLOWED_TRANSITIONS.BLOCKED).toEqual(['IN_PROGRESS', 'CANCELLED'])
    expect(ALLOWED_TRANSITIONS.COMPLETED).toEqual(['IN_PROGRESS'])
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual(['IN_PROGRESS'])
  })

  it('пропускает разрешённый переход', () => {
    expect(() =>
      assertTransition(stage({ status: 'NOT_STARTED' }), { toStatus: 'IN_PROGRESS' }, 'MANAGER'),
    ).not.toThrow()
  })

  it('запрещает переход из NOT_STARTED сразу в COMPLETED', () => {
    expectError(
      () =>
        assertTransition(
          stage({ status: 'NOT_STARTED' }),
          { toStatus: 'COMPLETED', result: 'Готово' },
          'MANAGER',
        ),
      'INVALID_TRANSITION',
    )
  })

  it('запрещает переход из BLOCKED сразу в COMPLETED', () => {
    expectError(
      () =>
        assertTransition(
          stage({ status: 'BLOCKED' }),
          { toStatus: 'COMPLETED', result: 'Готово' },
          'MANAGER',
        ),
      'INVALID_TRANSITION',
    )
  })

  it('запрещает переход в тот же статус', () => {
    expectError(
      () => assertTransition(stage({ status: 'IN_PROGRESS' }), { toStatus: 'IN_PROGRESS' }, 'ADMIN'),
      'INVALID_TRANSITION',
    )
  })
})

describe('условия завершения этапа', () => {
  it('не завершает этап без результата', () => {
    expectError(
      () =>
        assertTransition(
          stage({ status: 'IN_PROGRESS', result: null }),
          { toStatus: 'COMPLETED' },
          'MANAGER',
        ),
      'VALIDATION_ERROR',
    )
  })

  it('принимает результат, переданный вместе с переходом', () => {
    expect(() =>
      assertTransition(
        stage({ status: 'IN_PROGRESS', result: null }),
        { toStatus: 'COMPLETED', result: 'Договор подписан' },
        'MANAGER',
      ),
    ).not.toThrow()
  })

  it('не завершает этап с незакрытыми обязательными пунктами', () => {
    expectError(
      () =>
        assertTransition(
          stage({ status: 'IN_PROGRESS', requiredTasksTotal: 3, requiredTasksDone: 1 }),
          { toStatus: 'COMPLETED', result: 'Готово' },
          'MANAGER',
        ),
      'INVALID_TRANSITION',
    )
  })

  it('завершает этап, когда все обязательные пункты закрыты', () => {
    expect(() =>
      assertTransition(
        stage({ status: 'IN_PROGRESS', requiredTasksTotal: 2, requiredTasksDone: 2 }),
        { toStatus: 'COMPLETED', result: 'Готово' },
        'MANAGER',
      ),
    ).not.toThrow()
  })
})

describe('блокировка и отмена', () => {
  it('требует причину блокировки', () => {
    expectError(
      () => assertTransition(stage({ status: 'IN_PROGRESS' }), { toStatus: 'BLOCKED' }, 'MANAGER'),
      'VALIDATION_ERROR',
    )
  })

  it('блокирует этап с указанной причиной', () => {
    expect(() =>
      assertTransition(
        stage({ status: 'IN_PROGRESS' }),
        { toStatus: 'BLOCKED', blockingReason: 'Ожидаем ответ вуза' },
        'MANAGER',
      ),
    ).not.toThrow()
  })

  it('требует основание при отмене', () => {
    expectError(
      () => assertTransition(stage({ status: 'NOT_STARTED' }), { toStatus: 'CANCELLED' }, 'MANAGER'),
      'VALIDATION_ERROR',
    )
  })

  it('отменяет необязательный этап 5 с комментарием «не требуется»', () => {
    expect(() =>
      assertTransition(
        stage({ stageNumber: 5, status: 'NOT_STARTED' }),
        { toStatus: 'CANCELLED', comment: 'не требуется' },
        'MANAGER',
      ),
    ).not.toThrow()
  })
})

describe('переоткрытие', () => {
  it('переоткрывает завершённый этап только с комментарием', () => {
    expectError(
      () => assertTransition(stage({ status: 'COMPLETED' }), { toStatus: 'IN_PROGRESS' }, 'MANAGER'),
      'VALIDATION_ERROR',
    )
    expect(() =>
      assertTransition(
        stage({ status: 'COMPLETED' }),
        { toStatus: 'IN_PROGRESS', comment: 'Вуз прислал замечания' },
        'MANAGER',
      ),
    ).not.toThrow()
  })

  it('не даёт менеджеру переоткрыть отменённый этап', () => {
    expectError(
      () =>
        assertTransition(
          stage({ status: 'CANCELLED' }),
          { toStatus: 'IN_PROGRESS', comment: 'Понадобилось' },
          'MANAGER',
        ),
      'INVALID_TRANSITION',
    )
  })

  it('даёт администратору переоткрыть отменённый этап с комментарием', () => {
    expect(() =>
      assertTransition(
        stage({ status: 'CANCELLED' }),
        { toStatus: 'IN_PROGRESS', comment: 'Возобновляем работу' },
        'ADMIN',
      ),
    ).not.toThrow()
  })
})

describe('контрольный этап 14', () => {
  it('помечается как вычисляемый', () => {
    expect(isAutoManaged(14)).toBe(true)
    expect(isAutoManaged(13)).toBe(false)
  })

  it('не изменяется вручную даже администратором', () => {
    expectError(
      () =>
        assertTransition(
          stage({ stageNumber: 14, status: 'IN_PROGRESS' }),
          { toStatus: 'COMPLETED', result: 'Готово' },
          'ADMIN',
        ),
      'INVALID_TRANSITION',
    )
  })

  it('завершается, когда все этапы 1–13 закрыты или отменены', () => {
    const statuses: StageStatus[] = Array.from({ length: 13 }, (_, index) =>
      index === 4 ? 'CANCELLED' : 'COMPLETED',
    )
    expect(computeControlStatus(statuses)).toBe('COMPLETED')
  })

  it('находится в работе, пока есть незакрытые этапы', () => {
    const statuses: StageStatus[] = ['COMPLETED', 'IN_PROGRESS', 'NOT_STARTED']
    expect(computeControlStatus(statuses)).toBe('IN_PROGRESS')
  })

  it('не начат, пока не начат ни один этап', () => {
    expect(computeControlStatus(['NOT_STARTED', 'NOT_STARTED'])).toBe('NOT_STARTED')
  })
})

describe('текущий этап и прогресс', () => {
  const stages = [
    { stageNumber: 1, status: 'COMPLETED' as StageStatus },
    { stageNumber: 2, status: 'CANCELLED' as StageStatus },
    { stageNumber: 3, status: 'BLOCKED' as StageStatus },
    { stageNumber: 4, status: 'NOT_STARTED' as StageStatus },
    { stageNumber: 14, status: 'IN_PROGRESS' as StageStatus },
  ]

  it('берёт первый незакрытый этап и пропускает контрольный', () => {
    expect(findCurrentStage(stages)?.stageNumber).toBe(3)
  })

  it('возвращает null, когда все этапы закрыты', () => {
    expect(
      findCurrentStage([
        { stageNumber: 1, status: 'COMPLETED' as StageStatus },
        { stageNumber: 2, status: 'CANCELLED' as StageStatus },
      ]),
    ).toBeNull()
  })

  it('считает отменённые этапы закрытыми', () => {
    expect(computeProgressPercent(['COMPLETED', 'CANCELLED', 'IN_PROGRESS', 'NOT_STARTED'])).toBe(50)
  })

  it('на пустом наборе возвращает 0', () => {
    expect(computeProgressPercent([])).toBe(0)
  })
})

describe('чек-лист закрытого этапа', () => {
  it('пункты открытого этапа меняются', () => {
    expect(() => assertTasksEditable('NOT_STARTED', 3)).not.toThrow()
    expect(() => assertTasksEditable('IN_PROGRESS', 3)).not.toThrow()
    expect(() => assertTasksEditable('BLOCKED', 3)).not.toThrow()
  })

  it('пункты завершённого этапа не меняются', () => {
    // Иначе завершённый этап останется завершённым с незакрытым обязательным пунктом.
    expectError(() => assertTasksEditable('COMPLETED', 3), 'CONFLICT')
  })

  it('пункты отменённого этапа не меняются', () => {
    expectError(() => assertTasksEditable('CANCELLED', 3), 'CONFLICT')
  })

  it('у контрольного этапа своего чек-листа нет', () => {
    expectError(() => assertTasksEditable('IN_PROGRESS', 14), 'CONFLICT')
  })
})

describe('просрочка', () => {
  const past = new Date('2026-01-01T00:00:00.000Z')
  const today = new Date('2026-06-01T00:00:00.000Z')

  it('считает просроченным незакрытый этап с прошедшим сроком', () => {
    expect(isOverdue(past, 'IN_PROGRESS', today)).toBe(true)
    expect(isOverdue(past, 'BLOCKED', today)).toBe(true)
  })

  it('не считает просроченными закрытые и отменённые этапы', () => {
    expect(isOverdue(past, 'COMPLETED', today)).toBe(false)
    expect(isOverdue(past, 'CANCELLED', today)).toBe(false)
  })

  it('не считает просроченным этап без срока', () => {
    expect(isOverdue(null, 'IN_PROGRESS', today)).toBe(false)
  })
})

describe('контрольные точки (гибридный порядок этапов)', () => {
  const prior = (
    entries: Array<[number, StageStatus]>,
  ): Array<{ stageNumber: number; title: string; status: StageStatus }> =>
    entries.map(([stageNumber, status]) => ({
      stageNumber,
      title: `Этап ${stageNumber}`,
      status,
    }))

  it('этап до первой контрольной точки ничего не ждёт', () => {
    expect(isControlPoint(3)).toBe(false)
    expect(() =>
      assertControlPointReady(3, 'IN_PROGRESS', prior([[1, 'NOT_STARTED']])),
    ).not.toThrow()
  })

  it('подписание, передача материалов и занятия — контрольные точки', () => {
    expect(isControlPoint(6)).toBe(true)
    expect(isControlPoint(7)).toBe(true)
    expect(isControlPoint(11)).toBe(true)
  })

  it('нельзя начать, пока предыдущий этап не закрыт', () => {
    expect(() =>
      assertControlPointReady(
        6,
        'IN_PROGRESS',
        prior([
          [1, 'COMPLETED'],
          [2, 'COMPLETED'],
          [3, 'COMPLETED'],
          [4, 'IN_PROGRESS'],
          [5, 'NOT_STARTED'],
        ]),
      ),
    ).toThrow(AppError)
  })

  it('нельзя и завершить: это утверждение о процессе не слабее начала', () => {
    // Этап уже шёл, а предыдущий переоткрыли — завершать контрольную точку нельзя.
    expect(() =>
      assertControlPointReady(7, 'COMPLETED', prior([[6, 'IN_PROGRESS']])),
    ).toThrow(AppError)
  })

  it('отменённый предыдущий этап считается закрытым', () => {
    // Этап 5 необязательный: его отмена — обычный ход дела. Иначе отмена доработки
    // документов навсегда заперла бы подписание.
    expect(() =>
      assertControlPointReady(
        6,
        'IN_PROGRESS',
        prior([
          [1, 'COMPLETED'],
          [2, 'COMPLETED'],
          [3, 'COMPLETED'],
          [4, 'COMPLETED'],
          [5, 'CANCELLED'],
        ]),
      ),
    ).not.toThrow()
  })

  it('отмену самой контрольной точки не блокирует', () => {
    // Отмена ничего не утверждает о выполненной работе.
    expect(() =>
      assertControlPointReady(11, 'CANCELLED', prior([[7, 'NOT_STARTED']])),
    ).not.toThrow()
  })

  it('блокировку не запрещает: это честное сообщение, что работа встала', () => {
    expect(() =>
      assertControlPointReady(11, 'BLOCKED', prior([[7, 'NOT_STARTED']])),
    ).not.toThrow()
  })

  it('в ошибке перечислены конкретные мешающие этапы', () => {
    try {
      assertControlPointReady(
        11,
        'IN_PROGRESS',
        prior([
          [7, 'COMPLETED'],
          [8, 'IN_PROGRESS'],
          [9, 'NOT_STARTED'],
          [10, 'COMPLETED'],
        ]),
      )
      throw new Error('ожидалась ошибка')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const details = (error as AppError).details as {
        blockingStages: Array<{ stageNumber: number }>
      }
      // Фронт должен показать, что именно закрыть, а не «переход недопустим».
      expect(details.blockingStages.map((stage) => stage.stageNumber)).toEqual([8, 9])
    }
  })

  it('мешающие этапы перечислены по возрастанию номера', () => {
    const blocking = findBlockingStages(
      11,
      prior([
        [9, 'NOT_STARTED'],
        [7, 'BLOCKED'],
        [8, 'COMPLETED'],
      ]),
    )
    expect(blocking.map((stage) => stage.stageNumber)).toEqual([7, 9])
  })

  it('первая контрольная точка проходима, когда всё до неё закрыто', () => {
    expect(() =>
      assertControlPointReady(
        6,
        'COMPLETED',
        prior([
          [1, 'COMPLETED'],
          [2, 'COMPLETED'],
          [3, 'COMPLETED'],
          [4, 'COMPLETED'],
          [5, 'COMPLETED'],
        ]),
      ),
    ).not.toThrow()
  })

  it('пункт контрольной точки не отмечается, пока не закрыты предыдущие этапы', () => {
    // «Передана лицензия» у этапа 7 до подписания договора — та же неправда,
    // что начать этап 7 до подписания.
    expect(() =>
      assertChecklistReady(7, true, prior([[6, 'IN_PROGRESS']])),
    ).toThrow(/Этап 7 — контрольная точка: его пункты нельзя отмечать.*6 «Этап 6»/)
  })

  it('снять отметку можно всегда: это отказ от утверждения, а не утверждение', () => {
    expect(() => assertChecklistReady(7, false, prior([[6, 'IN_PROGRESS']]))).not.toThrow()
  })

  it('пункты этапа до точки и открытой контрольной точки отмечаются', () => {
    expect(() => assertChecklistReady(3, true, prior([[1, 'NOT_STARTED']]))).not.toThrow()
    expect(() => assertChecklistReady(7, true, prior([[6, 'COMPLETED']]))).not.toThrow()
    expect(() =>
      assertChecklistReady(8, true, prior([[6, 'COMPLETED'], [7, 'COMPLETED']])),
    ).not.toThrow()
  })

  it('пункты этапа за незавершённой точкой не отмечаются', () => {
    // «Продукт развёрнут у вуза» до подписанного договора — та же неправда.
    expect(() => assertChecklistReady(8, true, prior([[6, 'IN_PROGRESS'], [7, 'NOT_STARTED']]))).toThrow(
      /Этап 8 идёт после контрольной точки: его пункты нельзя отмечать/,
    )
  })
})

describe('контрольная точка — шлагбаум для всех следующих этапов', () => {
  const prior = (
    entries: Array<[number, StageStatus]>,
  ): Array<{ stageNumber: number; title: string; status: StageStatus }> =>
    entries.map(([stageNumber, status]) => ({ stageNumber, title: `Этап ${stageNumber}`, status }))

  it('этап 8 не начать и не завершить, пока не завершён этап 7', () => {
    const before = prior([
      [6, 'IN_PROGRESS'],
      [7, 'NOT_STARTED'],
    ])
    expect(() => assertControlPointReady(8, 'IN_PROGRESS', before)).toThrow(
      /Этап 8 идёт после контрольной точки: его нельзя начать.*6 «Этап 6», 7 «Этап 7»/,
    )
    expect(() => assertControlPointReady(8, 'COMPLETED', before)).toThrow(AppError)
  })

  it('отменённая контрольная точка дальше не пускает', () => {
    // «Договор не понадобился» не значит «договор подписан»: отмена этапа 6
    // комментарием «.» открывала передачу лицензии.
    expect(() =>
      assertControlPointReady(
        7,
        'IN_PROGRESS',
        prior([
          [1, 'COMPLETED'],
          [2, 'COMPLETED'],
          [3, 'COMPLETED'],
          [4, 'COMPLETED'],
          [5, 'CANCELLED'],
          [6, 'CANCELLED'],
        ]),
      ),
    ).toThrow(/Не закрыты: 6 «Этап 6»/)
    expect(() =>
      assertControlPointReady(9, 'IN_PROGRESS', prior([[6, 'COMPLETED'], [7, 'CANCELLED']])),
    ).toThrow(/Не завершены: 7 «Этап 7»/)
  })

  it('этапы 8–10 после завершённой точки 7 идут в любом порядке', () => {
    const passed = prior([
      [6, 'COMPLETED'],
      [7, 'COMPLETED'],
      [8, 'NOT_STARTED'],
    ])
    expect(() => assertControlPointReady(9, 'IN_PROGRESS', passed)).not.toThrow()
    expect(() => assertControlPointReady(10, 'COMPLETED', passed)).not.toThrow()
  })

  it('этапы 12 и 13 ждут завершения этапа 11', () => {
    expect(() =>
      assertControlPointReady(
        12,
        'IN_PROGRESS',
        prior([
          [6, 'COMPLETED'],
          [7, 'COMPLETED'],
          [11, 'IN_PROGRESS'],
        ]),
      ),
    ).toThrow(/Не завершены: 11 «Этап 11»/)
  })

  it('блокировать и отменять этап за точкой можно: это не утверждение о работе', () => {
    const closed = prior([[6, 'IN_PROGRESS']])
    expect(() => assertControlPointReady(8, 'BLOCKED', closed)).not.toThrow()
    expect(() => assertControlPointReady(8, 'CANCELLED', closed)).not.toThrow()
  })
})

describe('этап заперт контрольной точкой', () => {
  const stages = (entries: Array<[number, StageStatus]>) =>
    entries.map(([stageNumber, status]) => ({ stageNumber, title: `Этап ${stageNumber}`, status }))

  it('не начатый этап за незавершённой точкой заперт', () => {
    const all = stages([
      [6, 'IN_PROGRESS'],
      [7, 'NOT_STARTED'],
      [8, 'NOT_STARTED'],
    ])
    expect(isLockedByControlPoint({ stageNumber: 7, status: 'NOT_STARTED' }, all)).toBe(true)
    expect(isLockedByControlPoint({ stageNumber: 8, status: 'NOT_STARTED' }, all)).toBe(true)
  })

  it('начатый, заблокированный этап и этап после пройденной точки — не заперты', () => {
    // Этап 7, который уже в работе или заблокирован, — живая работа, о его сроке напоминают.
    const all = stages([
      [6, 'COMPLETED'],
      [7, 'BLOCKED'],
    ])
    expect(isLockedByControlPoint({ stageNumber: 7, status: 'BLOCKED' }, all)).toBe(false)
    expect(isLockedByControlPoint({ stageNumber: 5, status: 'NOT_STARTED' }, all)).toBe(false)
    expect(
      isLockedByControlPoint(
        { stageNumber: 7, status: 'NOT_STARTED' },
        stages([
          [1, 'COMPLETED'],
          [5, 'CANCELLED'],
          [6, 'COMPLETED'],
        ]),
      ),
    ).toBe(false)
  })

  it('отменённая точка не пройдена: этап за ней заперт', () => {
    expect(
      isLockedByControlPoint(
        { stageNumber: 7, status: 'NOT_STARTED' },
        stages([
          [5, 'COMPLETED'],
          [6, 'CANCELLED'],
        ]),
      ),
    ).toBe(true)
  })
})

describe('срок вот-вот выйдет', () => {
  const now = new Date('2026-09-22T12:00:00.000Z')
  const inDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  it('этап в пределах порога считается «скоро»', () => {
    expect(isDueSoon(inDays(1), 'IN_PROGRESS', now)).toBe(true)
    expect(isDueSoon(inDays(DEADLINE_WARNING_DAYS), 'IN_PROGRESS', now)).toBe(true)
  })

  it('за пределами порога — ещё не «скоро»', () => {
    expect(isDueSoon(inDays(DEADLINE_WARNING_DAYS + 1), 'IN_PROGRESS', now)).toBe(false)
    expect(isDueSoon(inDays(30), 'NOT_STARTED', now)).toBe(false)
  })

  it('просроченный этап в «скоро» не попадает', () => {
    // Иначе один этап считался бы дважды: и как просроченный, и как предстоящий.
    expect(isOverdue(inDays(-1), 'IN_PROGRESS', now)).toBe(true)
    expect(isDueSoon(inDays(-1), 'IN_PROGRESS', now)).toBe(false)
  })

  it('два признака никогда не верны одновременно', () => {
    for (const days of [-30, -3, -0.5, 0, 0.5, 3, 4, 30]) {
      const deadline = inDays(days)
      for (const status of ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] as const) {
        expect(isOverdue(deadline, status, now) && isDueSoon(deadline, status, now)).toBe(false)
      }
    }
  })

  it('закрытый этап не предупреждает о сроке', () => {
    // Завершённому и отменённому этапу срок уже не важен.
    expect(isDueSoon(inDays(1), 'COMPLETED', now)).toBe(false)
    expect(isDueSoon(inDays(1), 'CANCELLED', now)).toBe(false)
  })

  it('без срока предупреждать не о чем', () => {
    expect(isDueSoon(null, 'IN_PROGRESS', now)).toBe(false)
  })
})

describe('этап после записи удовлетворяет правилам своего статуса', () => {
  const completed: StageStatusFields = {
    status: 'COMPLETED',
    result: 'Договор подписан',
    blockingReason: null,
  }
  const blocked: StageStatusFields = {
    status: 'BLOCKED',
    result: null,
    blockingReason: 'Ждём юрслужбу вуза',
  }
  const afterWrite = (
    current: StageStatusFields,
    input: Parameters<typeof resolveStageFields>[1],
  ): (() => void) => () => assertStageFieldsComplete(resolveStageFields(current, input))

  it('результат завершённого этапа не стирается правкой полей', () => {
    // Раньше правка без смены статуса правил не касалась, и {"result": null} проходило.
    expectError(afterWrite(completed, { result: null }), 'VALIDATION_ERROR')
    expectError(afterWrite(completed, { result: '' }), 'VALIDATION_ERROR')
  })

  it('завершение с пустым результатом в теле берёт сохранённый, а не пишет пустой', () => {
    const inProgress: StageStatusFields = { status: 'IN_PROGRESS', result: 'Черновик итога', blockingReason: null }
    expect(resolveStageFields(inProgress, { status: 'COMPLETED', result: '' })).toEqual({
      status: 'COMPLETED',
      result: 'Черновик итога',
      blockingReason: null,
    })
  })

  it('причину у заблокированного этапа не стереть', () => {
    expectError(afterWrite(blocked, { blockingReason: '' }), 'VALIDATION_ERROR')
    expectError(afterWrite(blocked, { blockingReason: null }), 'VALIDATION_ERROR')
  })

  it('правка результата на другой непустой — можно', () => {
    expect(afterWrite(completed, { result: 'Договор подписан обеими сторонами' })).not.toThrow()
  })

  it('причина блокировки уходит вместе с блокировкой', () => {
    expect(resolveStageFields(blocked, { status: 'IN_PROGRESS' }).blockingReason).toBeNull()
  })
})

describe('дни — по московскому календарю', () => {
  it('«скоро срок» — по календарным дням, а не по часам', () => {
    // 21.09 10:00 по Москве. Срок 24.09 в 23:00 и 24.09 в 01:00 — оба «через 3 дн.»:
    // по часам первый выходил за трое суток и терял пометку.
    const now = new Date('2026-09-21T07:00:00.000Z')
    expect(isDueSoon(new Date('2026-09-24T20:00:00.000Z'), 'IN_PROGRESS', now)).toBe(
      isDueSoon(new Date('2026-09-23T22:00:00.000Z'), 'IN_PROGRESS', now),
    )
  })

  it('прошедший срок — не «скоро», а просрочка', () => {
    const now = new Date('2026-09-21T07:00:00.000Z')
    expect(isDueSoon(new Date('2026-09-21T06:00:00.000Z'), 'IN_PROGRESS', now)).toBe(false)
  })
})


describe('отмена контрольной точки', () => {
  const later = (entries: Array<[number, StageStatus]>) =>
    entries.map(([stageNumber, status]) => ({ stageNumber, title: `Этап ${stageNumber}`, status }))

  it('нельзя, если за ней уже идёт работа', () => {
    expect(() =>
      assertControlPointCancellable(6, later([[7, 'IN_PROGRESS'], [8, 'NOT_STARTED']])),
    ).toThrow(/Этап 6 — контрольная точка: его нельзя отменить.*Уже начаты: 7 «Этап 7»/)
  })

  it('можно, пока следующие этапы не начаты или отменены', () => {
    expect(() =>
      assertControlPointCancellable(6, later([[7, 'NOT_STARTED'], [8, 'CANCELLED'], [14, 'IN_PROGRESS']])),
    ).not.toThrow()
  })

  it('обычный этап отменяется без этой проверки', () => {
    expect(() => assertControlPointCancellable(5, later([[7, 'IN_PROGRESS']]))).not.toThrow()
  })
})

describe('запись истории этапа', () => {
  const inProgress: StageStatusFields = { status: 'IN_PROGRESS', result: null, blockingReason: null }
  const blocked: StageStatusFields = {
    status: 'BLOCKED',
    result: null,
    blockingReason: 'Вуз не подписал NDA',
  }

  it('блокировка пишет причину, хотя она пришла не комментарием', () => {
    const resulting = resolveStageFields(inProgress, {
      status: 'BLOCKED',
      blockingReason: 'Вуз не подписал NDA',
    })
    expect(historyComment('BLOCKED', resulting, undefined)).toBe('Вуз не подписал NDA')
  })

  it('завершение пишет результат — и присланный, и сохранённый ранее', () => {
    const sent = resolveStageFields(inProgress, { status: 'COMPLETED', result: 'Договор подписан' })
    expect(historyComment('COMPLETED', sent, null)).toBe('Договор подписан')

    const stored = resolveStageFields(
      { status: 'IN_PROGRESS', result: 'Материалы переданы', blockingReason: null },
      { status: 'COMPLETED' },
    )
    expect(historyComment('COMPLETED', stored, undefined)).toBe('Материалы переданы')
  })

  it('снятие блокировки пишет «что изменилось», хотя причина на этапе стирается', () => {
    const resulting = resolveStageFields(blocked, { status: 'IN_PROGRESS' })
    expect(resulting.blockingReason).toBeNull()
    expect(historyComment('IN_PROGRESS', resulting, 'NDA подписан 24.09')).toBe('NDA подписан 24.09')
  })

  it('снятие блокировки без комментария — запись без текста, а не отказ', () => {
    const resulting = resolveStageFields(blocked, { status: 'IN_PROGRESS' })
    expect(historyComment('IN_PROGRESS', resulting, undefined)).toBeNull()
    expect(historyComment('IN_PROGRESS', resulting, '   ')).toBeNull()
  })

  it('комментарий рядом с причиной не теряется и не повторяется', () => {
    const resulting = resolveStageFields(inProgress, {
      status: 'BLOCKED',
      blockingReason: 'Нет ответа от вуза',
    })
    expect(historyComment('BLOCKED', resulting, 'Напомнить в понедельник')).toBe(
      'Нет ответа от вуза\nНапомнить в понедельник',
    )
    expect(historyComment('BLOCKED', resulting, 'Нет ответа от вуза')).toBe('Нет ответа от вуза')
  })

  it('снятие блокировки разрешено без комментария', () => {
    expect(() =>
      assertTransition(
        { stageNumber: 3, status: 'BLOCKED', result: null, requiredTasksTotal: 0, requiredTasksDone: 0 },
        { toStatus: 'IN_PROGRESS' },
        'MANAGER',
      ),
    ).not.toThrow()
  })
})
