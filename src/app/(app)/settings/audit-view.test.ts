import { describe, expect, it } from 'vitest'
import {
  AUDIT_SUMMARY_MAX,
  auditActionLabel,
  auditActorLabel,
  auditObjectHref,
  auditObjectLabel,
  auditPayloadSummary,
  moscowDayEnd,
  moscowDayStart,
} from './audit-view'

/** Запись журнала во вкладке «Журнал действий»: подпись, ссылка, краткие подробности. */

const entry = (overrides: Record<string, unknown> = {}) => ({
  action: 'stage.status.change',
  objectType: 'WorkflowStage',
  objectId: 'stage-1',
  payload: null as Record<string, unknown> | null,
  cooperationId: null as string | null,
  ...overrides,
})

describe('подписи', () => {
  it('действие и тип объекта — словами, неизвестное — кодом', () => {
    expect(auditActionLabel('user.block')).toBe('Пользователь заблокирован')
    expect(auditActionLabel('something.new')).toBe('something.new')
    expect(auditObjectLabel('WorkflowStage')).toBe('Этап связки')
    expect(auditObjectLabel('Mystery')).toBe('Mystery')
  })
})

describe('кто действовал', () => {
  it('человек — фамилией с инициалами, без автора — вход или система', () => {
    const user = { id: 'u1', fullName: 'Кириллов Пётр Андреевич', role: 'MANAGER' as const }
    expect(auditActorLabel({ action: 'user.block', user })).toBe('Кириллов П. А.')
    expect(auditActorLabel({ action: 'auth.login.failure', user: null })).toBe('Без входа')
    expect(auditActorLabel({ action: 'stage.auto.recompute', user: null })).toBe('Система')
  })
})

describe('ссылка на объект', () => {
  it('вуз, программа, связка, документ, продукт', () => {
    expect(auditObjectHref(entry({ objectType: 'University', objectId: 'u1' }))).toBe('/universities/u1')
    expect(auditObjectHref(entry({ objectType: 'EducationalProgram', objectId: 'p1' }))).toBe('/programs/p1')
    expect(auditObjectHref(entry({ objectType: 'Cooperation', objectId: 'c1' }))).toBe('/cooperations/c1')
    expect(auditObjectHref(entry({ objectType: 'Document', objectId: 'd1' }))).toBe('/documents?document=d1')
    expect(auditObjectHref(entry({ objectType: 'ITProduct', objectId: 'i1' }))).toBe('/products?product=i1')
  })

  it('этап — на странице своей связки, сразу на нём', () => {
    expect(auditObjectHref(entry({ cooperationId: 'c1' }))).toBe('/cooperations/c1?stage=stage-1')
    expect(auditObjectHref(entry())).toBeNull()
  })

  it('у пользователя, выгрузки и пакетной пересборки рекомендаций ссылки нет', () => {
    expect(auditObjectHref(entry({ objectType: 'User', objectId: 'u1' }))).toBeNull()
    expect(auditObjectHref(entry({ objectType: 'Export', objectId: 'universities' }))).toBeNull()
    expect(auditObjectHref(entry({ objectType: 'Recommendation', objectId: 'batch' }))).toBeNull()
    expect(auditObjectHref(entry({ objectType: 'Recommendation', objectId: 'r1' }))).toBe(
      '/recommendations?recommendation=r1',
    )
  })
})

describe('подробности', () => {
  it('переход статуса этапа — словами, с номером этапа', () => {
    expect(
      auditPayloadSummary(entry({ payload: { from: 'IN_PROGRESS', to: 'COMPLETED', stageNumber: 3 } })),
    ).toBe('В работе → Завершён · этап 3')
  })

  it('смена роли — названиями ролей', () => {
    expect(
      auditPayloadSummary(entry({ action: 'user.role.change', payload: { from: 'MANAGER', to: 'ANALYST' } })),
    ).toBe('Менеджер партнёрств → Аналитик')
  })

  it('поля — по-русски, идентификаторы пропускаются', () => {
    expect(
      auditPayloadSummary(
        entry({ action: 'user.update', payload: { fields: ['fullName', 'position'], universityId: 'u1' } }),
      ),
    ).toBe('поля: ФИО, должность')
  })

  it('неудачный вход по несуществующей почте', () => {
    expect(
      auditPayloadSummary(entry({ action: 'auth.login.failure', payload: { address: '203.0.113.5', knownAccount: false } })),
    ).toBe('адрес: 203.0.113.5 · учётной записи с такой почтой нет')
  })

  it('статус связки — словами', () => {
    expect(auditPayloadSummary(entry({ action: 'cooperation.create', payload: { status: 'DRAFT' } }))).toBe(
      'статус: Черновик',
    )
  })

  it('закрытый вход называет счётчик словами', () => {
    expect(
      auditPayloadSummary(entry({ action: 'auth.login.blocked', payload: { counters: ['account-address'] } })),
    ).toBe('закрыт счётчиком: учётная запись с этого адреса')
  })

  it('пустая нагрузка — без строки', () => {
    expect(auditPayloadSummary(entry({ action: 'user.block', payload: null }))).toBeNull()
    expect(auditPayloadSummary(entry({ payload: { cooperationId: 'c1' } }))).toBeNull()
  })

  it('длинное обрезается', () => {
    const summary = auditPayloadSummary(entry({ action: 'x', payload: { fields: Array.from({ length: 60 }, (_, i) => `f${i}`) } }))
    expect(summary!.length).toBeLessThanOrEqual(AUDIT_SUMMARY_MAX)
    expect(summary!.endsWith('…')).toBe(true)
  })
})

describe('период', () => {
  it('границы московских суток', () => {
    expect(moscowDayStart('2026-09-25')).toBe('2026-09-24T21:00:00.000Z')
    expect(moscowDayEnd('2026-09-25')).toBe('2026-09-25T20:59:59.999Z')
    expect(moscowDayStart('')).toBeUndefined()
  })
})
