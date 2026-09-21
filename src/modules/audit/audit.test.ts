import { describe, expect, it } from 'vitest'
import { auditListQuerySchema, universityEventsQuerySchema } from './audit.schema'
import {
  applicationEventTitle,
  cooperationEventTitle,
  documentEventTitle,
  stageEventTitle,
} from './audit.rules'

describe('формулировки событий этапа', () => {
  it('завершение', () => {
    expect(stageEventTitle(6, 'Подписание документов', 'COMPLETED')).toBe(
      'Этап 6 «Подписание документов» завершён',
    )
  })

  it('блокировка и отмена читаются по-русски', () => {
    expect(stageEventTitle(7, 'Передача материалов', 'BLOCKED')).toContain('заблокирован')
    expect(stageEventTitle(5, 'Доработка документов', 'CANCELLED')).toContain('отменён')
  })

  it('для остальных статусов подставляется подпись из общего словаря', () => {
    expect(stageEventTitle(1, 'Поиск контакта', 'NOT_STARTED')).toContain('Не начат')
  })
})

describe('формулировки событий документа', () => {
  it('подписание называет версию', () => {
    expect(documentEventTitle('Договор о сотрудничестве', '2', 'SIGNED')).toBe(
      'Документ «Договор о сотрудничестве» (версия 2) подписан',
    )
  })

  it('отклонение и архив читаются по-русски', () => {
    expect(documentEventTitle('Договор', '1', 'REJECTED')).toContain('отклонён')
    expect(documentEventTitle('Договор', '1', 'ARCHIVED')).toContain('архив')
  })
})

describe('прочие события', () => {
  it('заявки называют количество и программу', () => {
    expect(applicationEventTitle(25, 'Программная инженерия')).toBe(
      'Подано заявок на обучение: 25 («Программная инженерия»)',
    )
  })

  it('связка без продукта описывается без упоминания продукта', () => {
    expect(cooperationEventTitle('Программная инженерия', null)).toBe(
      'Создана связка по программе «Программная инженерия»',
    )
  })

  it('связка с продуктом называет оба', () => {
    const title = cooperationEventTitle('Облачные технологии', 'Облачная платформа РТК')
    expect(title).toContain('Облачные технологии')
    expect(title).toContain('Облачная платформа РТК')
  })
})

describe('параметры журнала', () => {
  it('подставляет пагинацию по умолчанию', () => {
    const parsed = auditListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(20)
  })

  it('принимает фильтр по объекту и периоду', () => {
    const parsed = auditListQuerySchema.safeParse({
      objectType: 'WorkflowStage',
      from: '2026-01-01T00:00:00.000Z',
    })
    expect(parsed.success).toBe(true)
  })

  it('отклоняет дату не в формате ISO 8601', () => {
    expect(auditListQuerySchema.safeParse({ from: '01.01.2026' }).success).toBe(false)
  })

  it('лента событий ограничена сотней записей', () => {
    expect(universityEventsQuerySchema.parse({}).limit).toBe(20)
    expect(universityEventsQuerySchema.safeParse({ limit: '500' }).success).toBe(false)
  })
})
