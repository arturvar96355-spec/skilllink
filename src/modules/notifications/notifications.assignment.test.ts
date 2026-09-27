import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_TEXTS } from '@/modules/notify-channels/notify-channels.types'
import type { AssignmentContext, AssignmentStageRef, ResponsibleChange } from './notifications.assignment'

/**
 * «Вас назначили ответственным» в мессенджер (решение 205, замечание S4):
 * кому слать, что в тексте и кнопках, и что сбой отправки ничего не ломает.
 */
const repo = vi.hoisted(() => ({ loadAssignmentContext: vi.fn() }))
vi.mock('./notifications.repo', () => repo)

const channels = vi.hoisted(() => ({ sendToUser: vi.fn() }))
vi.mock('@/modules/notify-channels/notify-channels.service', () => channels)

const { buildAssignmentNotice, shouldNotifyAssignment } = await import('./notifications.assignment')
const service = await import('./notifications.service')

const NOW = new Date('2026-09-27T12:00:00.000Z')
const BASE = 'https://skilllink.example'

function stage(overrides: Partial<AssignmentStageRef> = {}): AssignmentStageRef {
  return {
    stageId: 'stage-3',
    stageNumber: 3,
    title: 'Согласование программы',
    status: 'IN_PROGRESS',
    deadline: new Date('2026-10-03T09:00:00.000Z'),
    ...overrides,
  }
}

const COOPERATION: AssignmentContext = {
  scope: 'cooperation',
  cooperationId: 'coop-1',
  universityName: 'СПбГУТ',
  programName: 'Программная инженерия',
  stages: [
    stage({ stageId: 'stage-1', stageNumber: 1, title: 'Первый контакт', status: 'COMPLETED' }),
    stage(),
    stage({ stageId: 'stage-4', stageNumber: 4, title: 'Договор', status: 'NOT_STARTED' }),
  ],
}

function change(overrides: Partial<ResponsibleChange> = {}): ResponsibleChange {
  return {
    scope: 'cooperation',
    objectId: 'coop-1',
    responsibleId: 'manager-1',
    previousResponsibleId: 'manager-2',
    actorId: 'admin-1',
    ...overrides,
  }
}

describe('кому слать', () => {
  it('новому ответственному, которого назначил другой', () => {
    expect(shouldNotifyAssignment(change())).toBe(true)
  })

  it('не шлёт, если ответственный тот же (повторный PATCH)', () => {
    expect(shouldNotifyAssignment(change({ responsibleId: 'manager-2' }))).toBe(false)
  })

  it('не шлёт, если назначил сам себя', () => {
    expect(shouldNotifyAssignment(change({ actorId: 'manager-1' }))).toBe(false)
  })

  it('не шлёт, если ответственного сняли', () => {
    expect(shouldNotifyAssignment(change({ responsibleId: null }))).toBe(false)
  })
})

describe('текст и кнопки', () => {
  it('связка: вуз — программа, текущий этап и срок; «Открыть связку» и «Принял» по текущему этапу', () => {
    const message = buildAssignmentNotice(COOPERATION, { now: NOW, baseUrl: BASE })
    expect(message.text).toBe(
      'Вас назначили ответственным за связку: СПбГУТ — Программная инженерия.\n' +
        'Текущий этап 3 «Согласование программы», срок 03.10.2026.',
    )
    expect(message.actions).toEqual([
      [
        { kind: 'open', text: ACTION_TEXTS.openCooperation, url: `${BASE}/cooperations/coop-1?stage=stage-3` },
        { kind: 'accept', text: ACTION_TEXTS.accept, target: { type: 'stage', id: 'stage-3' } },
      ],
    ])
  })

  it('просроченный срок так и назван; без срока — «срок не задан»', () => {
    const overdue = buildAssignmentNotice(
      { ...COOPERATION, stages: [stage({ deadline: new Date('2026-09-20T09:00:00.000Z') })] },
      { now: NOW, baseUrl: BASE },
    )
    expect(overdue.text).toContain('срок 20.09.2026 — просрочен')
    const noDeadline = buildAssignmentNotice(
      { ...COOPERATION, stages: [stage({ deadline: null })] },
      { now: NOW, baseUrl: BASE },
    )
    expect(noDeadline.text).toContain('срок не задан')
  })

  it('все этапы закрыты — так и сказано, «Принял» нет', () => {
    const message = buildAssignmentNotice(
      { ...COOPERATION, stages: [stage({ status: 'COMPLETED' })] },
      { now: NOW, baseUrl: BASE },
    )
    expect(message.text).toContain('Все этапы связки закрыты.')
    expect(message.actions?.flat().map((action) => action.kind)).toEqual(['open'])
  })

  it('без адреса стенда ссылки нет, «Принял» сама называет этап и вуз', () => {
    const message = buildAssignmentNotice(COOPERATION, { now: NOW, baseUrl: null })
    expect(message.actions).toEqual([
      [{ kind: 'accept', text: '✓ Принял: этап 3 · СПбГУТ', target: { type: 'stage', id: 'stage-3' } }],
    ])
  })

  it('этап: номер, название, вуз — программа и срок; ссылка ведёт к этапу', () => {
    const message = buildAssignmentNotice(
      {
        scope: 'stage',
        cooperationId: 'coop-1',
        universityName: 'СПбГУТ',
        programName: 'Программная инженерия',
        stage: stage(),
      },
      { now: NOW, baseUrl: BASE },
    )
    expect(message.text).toBe(
      'Вас назначили ответственным за этап 3 «Согласование программы»: СПбГУТ — Программная инженерия.\n' +
        'Срок 03.10.2026.',
    )
    expect(message.actions?.[0]?.[0]).toEqual({
      kind: 'open',
      text: ACTION_TEXTS.openStage,
      url: `${BASE}/cooperations/coop-1?stage=stage-3`,
    })
    expect(message.actions?.[0]?.[1]).toMatchObject({ kind: 'accept', target: { type: 'stage', id: 'stage-3' } })
  })

  it('вуз: название и сколько связок в работе; только «Открыть вуз»', () => {
    const message = buildAssignmentNotice(
      { scope: 'university', universityId: 'uni-1', universityName: 'СПбГУТ', openCooperations: 3 },
      { now: NOW, baseUrl: BASE },
    )
    expect(message.text).toBe('Вас назначили ответственным за вуз: СПбГУТ.\nВ работе 3 связки.')
    expect(message.actions).toEqual([[{ kind: 'open', text: ACTION_TEXTS.openUniversity, url: `${BASE}/universities/uni-1` }]])
  })
})

describe('sendAssignmentNotice', () => {
  const saved = { AUTH_URL: process.env.AUTH_URL, APP_BASE_URL: process.env.APP_BASE_URL }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_URL = BASE
    delete process.env.APP_BASE_URL
    repo.loadAssignmentContext.mockResolvedValue(COOPERATION)
    channels.sendToUser.mockResolvedValue({ sent: true, channel: 'telegram' })
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('отправляет новому ответственному через его канал', async () => {
    expect(await service.sendAssignmentNotice(change(), NOW)).toBe('sent')
    expect(repo.loadAssignmentContext).toHaveBeenCalledWith('cooperation', 'coop-1')
    expect(channels.sendToUser).toHaveBeenCalledTimes(1)
    const [userId, message] = channels.sendToUser.mock.calls[0] as [string, { text: string }]
    expect(userId).toBe('manager-1')
    expect(message.text).toContain('Вас назначили ответственным за связку: СПбГУТ')
  })

  it('не отправляет, если ответственный тот же', async () => {
    expect(await service.sendAssignmentNotice(change({ responsibleId: 'manager-2' }), NOW)).toBe('skipped')
    expect(channels.sendToUser).not.toHaveBeenCalled()
    expect(repo.loadAssignmentContext).not.toHaveBeenCalled()
  })

  it('ошибка отправки не бросает — только «failed» и строка в журнале приложения', async () => {
    channels.sendToUser.mockRejectedValue(new Error('Telegram недоступен'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(service.sendAssignmentNotice(change(), NOW)).resolves.toBe('failed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('у получателя нет подключённого канала — «not-delivered», без ошибки', async () => {
    channels.sendToUser.mockResolvedValue({ sent: false, channel: null })
    expect(await service.sendAssignmentNotice(change(), NOW)).toBe('not-delivered')
  })

  it('объекта уже нет — ничего не отправляет', async () => {
    repo.loadAssignmentContext.mockResolvedValue(null)
    expect(await service.sendAssignmentNotice(change(), NOW)).toBe('skipped')
    expect(channels.sendToUser).not.toHaveBeenCalled()
  })

  it('в тексте нет ФИО и почт — только названия и срок', async () => {
    await service.sendAssignmentNotice(change(), NOW)
    const sent = JSON.stringify(channels.sendToUser.mock.calls)
    expect(sent).not.toMatch(/@|Админ|admin-1/)
  })
})
