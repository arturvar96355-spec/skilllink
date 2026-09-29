import type { PrismaClient } from '../src/generated/prisma/client'
import { moscowIsoDate } from '../src/shared/utils/date'

/**
 * Личный кабинет не пустой ни у одной демо-учётки (решение 236).
 *
 * До этого у администратора, второго администратора, руководителя, аналитика
 * и наблюдателя кабинет состоял из нулей: связок они не ведут, поручений им
 * не давали, а у руководителя, аналитика и наблюдателя в журнале не было ни
 * одного действия — «Моя страница сотрудника» так и писала «В журнале нет его
 * действий», хотя руководитель раздал все демо-поручения.
 *
 * Что добавляется — только то, что не входит в числа сценария показа
 * (`npm run demo:check`): связки, этапы, встречи, заявки, программы и
 * рекомендации не трогаются.
 *
 * 1. Поручения (`isMock`) тем, у кого их не было: администратору, второму
 *    администратору, руководителю (от администратора по ИБ), наблюдателю;
 *    аналитику — ещё одно, уже сделанное, чтобы вкладка «Сделанные» не пустовала.
 * 2. Записи журнала, согласованные с посеянными поручениями: «Дано поручение»
 *    от автора каждого демо-поручения (и из `seed-assignments.ts`), «Изменён
 *    статус поручения» от исполнителя — у тех, что в работе или сделаны.
 *    Плюс выгрузки CSV аналитика и наблюдателя — их обычная работа.
 *    В полезной нагрузке `demo: true`: запись посеяна, её никто не делал.
 *
 * Уведомления и «Система заметила» у сотрудников уже есть — они считаются
 * по данным. Каналы мессенджеров не сеются: выдуманный номер чата на стенде
 * с настоящим ботом получал бы рассылки. Встречи не сеются: они входят
 * в «Пульс» и числа сценария.
 *
 * Отдельный файл, как `seed-assignments.ts`: строки `seed.ts` правят параллельные ветки.
 */

export interface ProfileSeedContext {
  now: Date
  daysAgo: (days: number) => Date
  /** Сдвиг будущей даты за конец экспертизы (решение 131); прошлые даты — как есть. */
  stabilize: (date: Date) => Date
  universityId: (key: string) => string
  head: string
  admin: string
  admin2: string
  analyst: string
}

export interface ProfileSeedResult {
  assignments: number
  auditRows: number
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export async function seedProfileContent(prisma: PrismaClient, ctx: ProfileSeedContext): Promise<ProfileSeedResult> {
  const { now, daysAgo } = ctx
  const viewer = await prisma.user.findUniqueOrThrow({ where: { email: 'viewer@skilllink.demo' }, select: { id: true } })
  const due = (days: number) => {
    const moment = days > 0 ? ctx.stabilize(new Date(now.getTime() + days * DAY)) : new Date(now.getTime() + days * DAY)
    return new Date(`${moscowIsoDate(moment)}T00:00:00.000Z`)
  }
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR)

  // ── 1. Поручения тем, у кого их не было ──
  const rows = [
    {
      assigneeId: ctx.admin,
      authorId: ctx.head,
      text: 'Завести учётную запись новому менеджеру партнёрств и выдать временный пароль',
      dueAt: due(3),
      priority: 'HIGH' as const,
      status: 'NEW' as const,
      createdAt: hoursAgo(5),
    },
    {
      assigneeId: ctx.admin2,
      authorId: ctx.head,
      text: 'Проверить целостность журнала действий перед показом и приложить итог проверки',
      dueAt: due(2),
      priority: 'NORMAL' as const,
      status: 'IN_PROGRESS' as const,
      createdAt: daysAgo(1),
    },
    {
      assigneeId: ctx.admin2,
      authorId: ctx.head,
      text: 'Сверить список администраторов системы с приказом о доступе',
      dueAt: due(-3),
      priority: 'NORMAL' as const,
      status: 'DONE' as const,
      doneAt: daysAgo(3),
      createdAt: daysAgo(7),
    },
    {
      assigneeId: ctx.head,
      authorId: ctx.admin2,
      text: 'Подтвердить, кому из сотрудников нужен доступ к журналу действий',
      dueAt: due(4),
      priority: 'NORMAL' as const,
      status: 'NEW' as const,
      createdAt: hoursAgo(20),
    },
    {
      assigneeId: ctx.analyst,
      authorId: ctx.head,
      text: 'Сравнить дефициты навыков по регионам для отчёта руководителю',
      universityId: ctx.universityId('kazan'),
      dueAt: due(-2),
      priority: 'NORMAL' as const,
      status: 'DONE' as const,
      doneAt: daysAgo(3),
      createdAt: daysAgo(8),
    },
    {
      assigneeId: viewer.id,
      authorId: ctx.head,
      text: 'Посмотреть отчёт руководителю за сентябрь и выписать вопросы к аудиту',
      dueAt: due(5),
      priority: 'NORMAL' as const,
      status: 'NEW' as const,
      createdAt: daysAgo(1),
    },
  ]
  await prisma.assignment.createMany({
    data: rows.map((row) => ({
      ...row,
      universityId: row.universityId ?? null,
      doneAt: row.doneAt ?? null,
      updatedAt: row.doneAt ?? row.createdAt,
      isMock: true,
    })),
  })

  // ── 2. Журнал, согласованный с демо-поручениями (и этими, и из seed-assignments.ts) ──
  // Те же действие, тип объекта и поля, что пишет сервис поручений; текст не пишется —
  // как в сервисе. Время: «дано» — момент создания, «в работе» — половина пути
  // до выполнения (или до «сейчас»), «сделано» — момент выполнения.
  const assignments = await prisma.assignment.findMany({
    where: { isMock: true },
    select: { id: true, authorId: true, assigneeId: true, priority: true, dueAt: true, status: true, createdAt: true, doneAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const audit: Array<{
    userId: string
    action: string
    objectType: string
    objectId: string
    payload: Record<string, unknown>
    createdAt: Date
  }> = []
  for (const item of assignments) {
    audit.push({
      userId: item.authorId,
      action: 'assignment.create',
      objectType: 'Assignment',
      objectId: item.id,
      payload: { assigneeId: item.assigneeId, priority: item.priority, dueDate: item.dueAt.toISOString().slice(0, 10), demo: true },
      createdAt: item.createdAt,
    })
    if (item.status === 'NEW') continue
    const until = item.doneAt ?? now
    const takenAt = new Date(item.createdAt.getTime() + (until.getTime() - item.createdAt.getTime()) / 2)
    audit.push({
      userId: item.assigneeId,
      action: 'assignment.status',
      objectType: 'Assignment',
      objectId: item.id,
      payload: { from: 'NEW', to: 'IN_PROGRESS', demo: true },
      createdAt: takenAt,
    })
    if (item.status === 'DONE' && item.doneAt) {
      audit.push({
        userId: item.assigneeId,
        action: 'assignment.status',
        objectType: 'Assignment',
        objectId: item.id,
        payload: { from: 'IN_PROGRESS', to: 'DONE', demo: true },
        createdAt: item.doneAt,
      })
    }
  }

  // Выгрузки CSV — обычная работа аналитика и наблюдателя: число строк — настоящее
  // на момент заливки, фильтров нет (выгружен весь реестр).
  const [programs, cooperations] = await Promise.all([
    prisma.educationalProgram.count({ where: { archivedAt: null } }),
    prisma.cooperation.count(),
  ])
  const exportRow = (userId: string, dataset: string, rowsCount: number, at: Date) => ({
    userId,
    action: 'export.download',
    objectType: 'Export',
    objectId: dataset,
    payload: { dataset, rows: rowsCount, limit: 1000, filters: {}, demo: true },
    createdAt: at,
  })
  audit.push(
    exportRow(ctx.analyst, 'programs', Math.min(programs, 1000), hoursAgo(26)),
    exportRow(viewer.id, 'cooperations', Math.min(cooperations, 1000), hoursAgo(28)),
  )

  // Порядок вставки — по времени: у журнала цепочка по порядку записи (chain_seq).
  audit.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const row of audit) {
    await prisma.auditLog.create({ data: row as never })
  }
  return { assignments: rows.length, auditRows: audit.length }
}
