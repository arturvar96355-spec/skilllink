import type { PrismaClient } from '../src/generated/prisma/client'
import { moscowIsoDate } from '../src/shared/utils/date'

/**
 * Демо-поручения (решение 207): 7 штук, все `isMock`. Руководитель (и один раз
 * администратор) поручает менеджерам и аналитику; разные статусы и важность,
 * одно открытое поручение просрочено — на нём видно красный счётчик «Команды»
 * и пункт «Срок поручения прошёл» в колокольчике.
 *
 * Отдельный файл, как `seed-vendors.ts`: строки `seed.ts` правят параллельные ветки.
 *
 * Сроки — календарные даты по Москве. Будущие сроки сдвигаются тем же `stabilize`,
 * что сроки этапов (решение 131): до конца экспертизы стенд не «протухает» —
 * открытое поручение не становится просроченным само, пока его никто не трогал.
 */

export interface AssignmentSeedContext {
  now: Date
  daysAgo: (days: number) => Date
  /** Сдвиг будущей даты за конец экспертизы (решение 131); прошлые даты — как есть. */
  stabilize: (date: Date) => Date
  universityId: (key: string) => string
  /** id связки по ключу «вуз-программа»; нет такой — ошибка сида. */
  cooperationId: (key: string) => string
  head: string
  admin: string
  manager: string
  manager2: string
  analyst: string
}

const DAY = 24 * 60 * 60 * 1000

export async function seedAssignments(prisma: PrismaClient, ctx: AssignmentSeedContext): Promise<number> {
  const { now, daysAgo } = ctx
  /** Срок через `days` дней (минус — в прошлом) — календарная дата по Москве, столбец `date`. */
  const due = (days: number) => {
    const moment = days > 0 ? ctx.stabilize(new Date(now.getTime() + days * DAY)) : new Date(now.getTime() + days * DAY)
    return new Date(`${moscowIsoDate(moment)}T00:00:00.000Z`)
  }
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

  const rows = [
    {
      // Просрочено: срок вышел позавчера, менеджер взял в работу, но не закрыл.
      assigneeId: ctx.manager,
      authorId: ctx.head,
      text: 'Позвонить в МТУСИ: подтвердить состав кафедры на осень',
      universityId: ctx.universityId('mtuci'),
      dueAt: due(-2),
      priority: 'HIGH' as const,
      status: 'IN_PROGRESS' as const,
      createdAt: daysAgo(5),
    },
    {
      assigneeId: ctx.manager,
      authorId: ctx.head,
      text: 'Согласовать с НГУ дату обучения преподавателей',
      universityId: ctx.universityId('nsu'),
      cooperationId: ctx.cooperationId('nsu-nsu-ai'),
      dueAt: due(3),
      priority: 'NORMAL' as const,
      status: 'IN_PROGRESS' as const,
      createdAt: daysAgo(3),
    },
    {
      assigneeId: ctx.manager,
      authorId: ctx.head,
      text: 'Подготовить проект договора для УрФУ',
      universityId: ctx.universityId('urfu'),
      cooperationId: ctx.cooperationId('urfu-urfu-security'),
      dueAt: due(5),
      priority: 'HIGH' as const,
      status: 'NEW' as const,
      createdAt: hoursAgo(2),
    },
    {
      assigneeId: ctx.manager,
      authorId: ctx.head,
      text: 'Отправить в СПбГУТ программу повышения квалификации',
      universityId: ctx.universityId('spbgu'),
      dueAt: due(-1),
      priority: 'NORMAL' as const,
      status: 'DONE' as const,
      doneAt: daysAgo(2),
      createdAt: daysAgo(6),
    },
    {
      assigneeId: ctx.manager2,
      authorId: ctx.admin,
      text: 'Собрать отзывы преподавателей о курсе и приложить к карточке вуза',
      universityId: ctx.universityId('nsu'),
      dueAt: due(4),
      priority: 'NORMAL' as const,
      status: 'NEW' as const,
      createdAt: daysAgo(1),
    },
    {
      assigneeId: ctx.manager2,
      authorId: ctx.head,
      text: 'Уточнить у Казанского университета план набора на весну',
      universityId: ctx.universityId('kazan'),
      dueAt: due(-4),
      priority: 'NORMAL' as const,
      status: 'DONE' as const,
      doneAt: daysAgo(4),
      createdAt: daysAgo(9),
    },
    {
      assigneeId: ctx.analyst,
      authorId: ctx.head,
      text: 'Сверить показатели набора по программам МТУСИ с отчётом вуза',
      universityId: ctx.universityId('mtuci'),
      dueAt: due(6),
      priority: 'NORMAL' as const,
      status: 'IN_PROGRESS' as const,
      createdAt: daysAgo(2),
    },
  ]

  await prisma.assignment.createMany({
    data: rows.map((row) => ({ ...row, doneAt: row.doneAt ?? null, updatedAt: row.doneAt ?? row.createdAt, isMock: true })),
  })
  return rows.length
}
