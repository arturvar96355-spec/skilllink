import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `assertStaffResponsible` — единственная проверка «можно ли назначить этого
 * пользователя ответственным», общая для вуза, связки, этапа, встречи и документа
 * (все они зовут её напрямую, без своей копии правила).
 */
const mocks = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
}))

vi.mock('@/shared/db/prisma', () => ({ prisma: { user: mocks.user } }))

const { assertStaffResponsible } = await import('./entity-links')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertStaffResponsible', () => {
  it('принимает действующего менеджера, руководителя или администратора', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'HEAD']) {
      mocks.user.findFirst.mockResolvedValueOnce({ role, isReviewer: false })
      await expect(assertStaffResponsible('user-1')).resolves.toBeUndefined()
    }
  })

  it('отклоняет несуществующего или неактивного пользователя', async () => {
    mocks.user.findFirst.mockResolvedValue(null)
    await expect(assertStaffResponsible('ghost')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'responsibleId', message: 'Сотрудник не найден' }],
    })
  })

  it('отклоняет аналитика и наблюдателя — не RESPONSIBLE_ROLES', async () => {
    for (const role of ['ANALYST', 'VIEWER', 'UNIVERSITY_REP']) {
      mocks.user.findFirst.mockResolvedValueOnce({ role, isReviewer: false })
      await expect(assertStaffResponsible('user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
  })

  it('отклоняет учётную запись эксперта хакатона (isReviewer), даже с ролью ADMIN или HEAD', async () => {
    for (const role of ['ADMIN', 'HEAD', 'MANAGER']) {
      mocks.user.findFirst.mockResolvedValueOnce({ role, isReviewer: true })
      await expect(assertStaffResponsible('expert-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [
          {
            field: 'responsibleId',
            message: 'Учётная запись эксперта хакатона: ответственным быть не может',
          },
        ],
      })
    }
  })

  it('фильтрует по isActive: неактивный не находится и отклоняется как несуществующий', async () => {
    mocks.user.findFirst.mockResolvedValue(null)
    await expect(assertStaffResponsible('blocked-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(mocks.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'blocked-1', isActive: true },
      select: { role: true, isReviewer: true },
    })
  })
})
