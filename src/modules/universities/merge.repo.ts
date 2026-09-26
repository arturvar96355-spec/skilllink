import { prisma } from '@/shared/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import {
  MERGEABLE_UNIVERSITY_FIELDS,
  type MergeableUniversityField,
  type MergeFieldRule,
  type SurvivorshipEntryDto,
} from '@/shared/contracts/data-quality'
import type { UniversityStatus } from '@/shared/contracts/enums'
import {
  assertCanMerge,
  assertCanUndo,
  planSurvivorship,
  planUndoFields,
  undoDeadline,
  type MovedIds,
  type UniversityFields,
} from './merge.rules'

type Tx = Prisma.TransactionClient

/**
 * Слияние вузов и его отмена — каждое одной транзакцией (решение 134).
 * Строки обоих вузов блокируются в порядке id: встречные слияния A→B и B→A
 * иначе взаимно заблокировались бы (так же, как у навыков, решение 107).
 */

const fieldSelect = Object.fromEntries(MERGEABLE_UNIVERSITY_FIELDS.map((field) => [field, true])) as Record<
  MergeableUniversityField,
  true
>

const universitySelect = {
  ...fieldSelect,
  id: true,
  status: true,
  archivedAt: true,
  mergedIntoId: true,
  updatedAt: true,
} satisfies Prisma.UniversitySelect

const userRefSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect

const mergeSelect = {
  id: true,
  sourceId: true,
  targetId: true,
  mergedAt: true,
  undoUntil: true,
  undoneAt: true,
  fieldRules: true,
  survivorship: true,
  moved: true,
  before: true,
  mergedBy: { select: userRefSelect },
} satisfies Prisma.UniversityMergeSelect

export type MergeRow = Prisma.UniversityMergeGetPayload<{ select: typeof mergeSelect }>

function fieldsOf(row: Record<MergeableUniversityField, string | number | null>): UniversityFields {
  return Object.fromEntries(MERGEABLE_UNIVERSITY_FIELDS.map((field) => [field, row[field]])) as UniversityFields
}

/**
 * Поля для записи в вуз. Обязательные (название, город, регион) пустыми сюда не попадают:
 * у цели они всегда есть, `non_null` и остальные правила пустое не выбирают, ручное
 * значение проверяет схема, отмена возвращает прежнее значение цели.
 */
function toUpdate(fields: Partial<UniversityFields>): Prisma.UniversityUpdateInput {
  return fields as Prisma.UniversityUpdateInput
}

async function lockUniversities(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...ids].sort()) {
    await tx.$queryRaw`SELECT id FROM universities WHERE id = ${id} FOR UPDATE`
  }
}

/** Состояние до слияния: чтобы отмена вернула цель и источник как были. */
interface MergeBefore {
  target: { fields: UniversityFields; updatedAt: string }
  source: { status: UniversityStatus; archivedAt: string | null }
}

export type MergeOutcome =
  | { status: 'not-found'; which: 'source' | 'target' }
  | { status: 'merged'; merge: MergeRow; sourceName: string }

export async function mergeUniversities(input: {
  sourceId: string
  targetId: string
  userId: string
  rules: Partial<Record<MergeableUniversityField, MergeFieldRule>>
  manual: Partial<UniversityFields>
  now: Date
}): Promise<MergeOutcome> {
  return prisma.$transaction(async (tx) => {
    await lockUniversities(tx, [input.sourceId, input.targetId])
    const [source, target] = await Promise.all([
      tx.university.findUnique({ where: { id: input.sourceId }, select: universitySelect }),
      tx.university.findUnique({ where: { id: input.targetId }, select: universitySelect }),
    ])
    if (!source) return { status: 'not-found', which: 'source' }
    if (!target) return { status: 'not-found', which: 'target' }
    assertCanMerge(source, target)

    const plan = planSurvivorship(
      { fields: fieldsOf(target), updatedAt: target.updatedAt },
      { fields: fieldsOf(source), updatedAt: source.updatedAt },
      input.rules,
      input.manual,
    )

    const where = { universityId: input.sourceId }
    const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((row) => row.id)
    const [programs, contacts, cooperations, meetings, documents, applications, users, targetPrimary] = await Promise.all([
      ids(tx.educationalProgram.findMany({ where, select: { id: true } })),
      ids(tx.contact.findMany({ where, select: { id: true } })),
      ids(tx.cooperation.findMany({ where, select: { id: true } })),
      ids(tx.meeting.findMany({ where, select: { id: true } })),
      ids(tx.document.findMany({ where, select: { id: true } })),
      ids(tx.application.findMany({ where, select: { id: true } })),
      ids(tx.user.findMany({ where, select: { id: true } })),
      tx.contact.count({ where: { universityId: input.targetId, isPrimary: true } }),
    ])

    // Основной контакт у вуза один (частичный уникальный индекс): если у цели он есть,
    // основной контакт дубля переходит обычным. Отмена вернёт признак.
    const demotedContacts =
      targetPrimary > 0
        ? await ids(tx.contact.findMany({ where: { ...where, isPrimary: true }, select: { id: true } }))
        : []
    if (demotedContacts.length > 0) {
      await tx.contact.updateMany({ where: { id: { in: demotedContacts } }, data: { isPrimary: false } })
    }

    const move = { universityId: input.targetId }
    await tx.educationalProgram.updateMany({ where: { id: { in: programs } }, data: move })
    await tx.contact.updateMany({ where: { id: { in: contacts } }, data: move })
    await tx.cooperation.updateMany({ where: { id: { in: cooperations } }, data: move })
    await tx.meeting.updateMany({ where: { id: { in: meetings } }, data: move })
    await tx.document.updateMany({ where: { id: { in: documents } }, data: move })
    await tx.application.updateMany({ where: { id: { in: applications } }, data: move })
    await tx.user.updateMany({ where: { id: { in: users } }, data: move })

    if (Object.keys(plan.targetUpdate).length > 0) {
      await tx.university.update({ where: { id: input.targetId }, data: toUpdate(plan.targetUpdate) })
    }
    await tx.university.update({
      where: { id: input.sourceId },
      data: { status: 'ARCHIVED', archivedAt: source.archivedAt ?? input.now, mergedIntoId: input.targetId },
    })

    const moved: MovedIds = { programs, contacts, cooperations, meetings, documents, applications, users, demotedContacts }
    const before: MergeBefore = {
      target: { fields: fieldsOf(target), updatedAt: target.updatedAt.toISOString() },
      source: { status: source.status, archivedAt: source.archivedAt?.toISOString() ?? null },
    }
    const merge = await tx.universityMerge.create({
      data: {
        sourceId: input.sourceId,
        targetId: input.targetId,
        mergedById: input.userId,
        mergedAt: input.now,
        undoUntil: undoDeadline(input.now),
        fieldRules: Object.fromEntries(MERGEABLE_UNIVERSITY_FIELDS.map((field) => [field, input.rules[field] ?? 'non_null'])),
        survivorship: plan.entries as unknown as Prisma.InputJsonValue,
        moved: moved as unknown as Prisma.InputJsonValue,
        before: before as unknown as Prisma.InputJsonValue,
      },
      select: mergeSelect,
    })
    return { status: 'merged', merge, sourceName: source.name as string }
  })
}

export async function findMerge(id: string): Promise<MergeRow | null> {
  return prisma.universityMerge.findUnique({ where: { id }, select: mergeSelect })
}

export interface ReturnedIds {
  programs: number
  contacts: number
  cooperations: number
  meetings: number
  documents: number
  applications: number
  users: number
}

export type UndoOutcome =
  | { status: 'not-found' }
  | {
      status: 'undone'
      merge: MergeRow
      returned: ReturnedIds
      restored: MergeableUniversityField[]
      kept: MergeableUniversityField[]
    }

/**
 * Отмена слияния: объекты из журнала возвращаются источнику — и вместе с ними то,
 * что появилось после слияния на перенесённых программах и связках (новая встреча
 * по перенесённой связке иначе осталась бы у цели, а связка ушла бы к источнику).
 * Новое, заведённое у цели без связи с перенесённым, остаётся у цели.
 */
export async function undoMerge(id: string, userId: string, now: Date): Promise<UndoOutcome> {
  return prisma.$transaction(async (tx) => {
    const found = await tx.universityMerge.findUnique({ where: { id }, select: { sourceId: true, targetId: true } })
    if (!found) return { status: 'not-found' }
    await lockUniversities(tx, [found.sourceId, found.targetId])
    // Под блокировкой вузов — повторное чтение: две одновременные отмены не пройдут обе.
    await tx.$queryRaw`SELECT id FROM university_merges WHERE id = ${id} FOR UPDATE`
    const merge = await tx.universityMerge.findUniqueOrThrow({ where: { id }, select: mergeSelect })
    assertCanUndo(merge, now)

    const moved = merge.moved as unknown as MovedIds
    const before = merge.before as unknown as MergeBefore
    const entries = merge.survivorship as unknown as SurvivorshipEntryDto[]
    const { sourceId, targetId } = merge
    const back = { universityId: sourceId }
    const onTarget = { universityId: targetId }

    const programs = await tx.educationalProgram.updateMany({ where: { id: { in: moved.programs }, ...onTarget }, data: back })
    const cooperations = await tx.cooperation.updateMany({
      where: { ...onTarget, OR: [{ id: { in: moved.cooperations } }, { programId: { in: moved.programs } }] },
      data: back,
    })
    // Связки источника после возврата — перенесённые и заведённые на его программах.
    const sourceCooperations = (
      await tx.cooperation.findMany({ where: { universityId: sourceId }, select: { id: true } })
    ).map((row) => row.id)
    const linked = (ids: string[]) => [
      { id: { in: ids } },
      { cooperationId: { in: sourceCooperations } },
      { programId: { in: moved.programs } },
    ]
    const meetings = await tx.meeting.updateMany({ where: { ...onTarget, OR: linked(moved.meetings) }, data: back })
    const documents = await tx.document.updateMany({ where: { ...onTarget, OR: linked(moved.documents) }, data: back })
    const applications = await tx.application.updateMany({
      where: { ...onTarget, OR: [{ id: { in: moved.applications } }, { programId: { in: moved.programs } }] },
      data: back,
    })
    const users = await tx.user.updateMany({ where: { id: { in: moved.users }, ...onTarget }, data: back })

    // Контакты — сначала снять «основной» с тех, кто вернётся основным, потом вернуть.
    const contacts = await tx.contact.updateMany({ where: { id: { in: moved.contacts }, ...onTarget }, data: back })
    if (moved.demotedContacts.length > 0) {
      const hasPrimary = await tx.contact.count({ where: { universityId: sourceId, isPrimary: true } })
      if (hasPrimary === 0) {
        await tx.contact.updateMany({
          where: { id: { in: moved.demotedContacts.slice(0, 1) }, universityId: sourceId },
          data: { isPrimary: true },
        })
      }
    }

    const target = await tx.university.findUniqueOrThrow({ where: { id: targetId }, select: universitySelect })
    const undo = planUndoFields(entries, fieldsOf(target))
    if (Object.keys(undo.restore).length > 0) {
      await tx.university.update({ where: { id: targetId }, data: toUpdate(undo.restore) })
    }
    await tx.university.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: null,
        status: before.source.status,
        archivedAt: before.source.archivedAt ? new Date(before.source.archivedAt) : null,
      },
    })
    const updated = await tx.universityMerge.update({
      where: { id },
      data: { undoneAt: now, undoneById: userId },
      select: mergeSelect,
    })
    return {
      status: 'undone',
      merge: updated,
      returned: {
        programs: programs.count,
        contacts: contacts.count,
        cooperations: cooperations.count,
        meetings: meetings.count,
        documents: documents.count,
        applications: applications.count,
        users: users.count,
      },
      restored: undo.restored,
      kept: undo.kept,
    }
  })
}
