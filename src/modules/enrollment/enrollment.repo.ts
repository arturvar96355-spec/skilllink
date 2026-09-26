import { prisma } from '@/shared/db/prisma'
import { textContains } from '@/shared/db/text-search'
import { toSkipTake } from '@/shared/http/pagination'
import type { Prisma } from '@/generated/prisma/client'
import type { SchoolCourseListQuery } from './enrollment.schema'

/** Курсы по ключам названий — вместе с потоками. */
export async function findCoursesByKeys(keys: readonly string[]) {
  if (keys.length === 0) return []
  return prisma.schoolCourse.findMany({
    where: { nameKey: { in: [...keys] } },
    select: { id: true, name: true, nameKey: true, streams: { select: { id: true, number: true } } },
  })
}

/** Какие из номеров заявок уже загружены — и когда слушатель ушёл в LMS. */
export async function findOrdersByNumbers(orderNos: readonly string[]) {
  if (orderNos.length === 0) return []
  return prisma.siteOrder.findMany({
    where: { orderNo: { in: [...orderNos] } },
    select: { orderNo: true, courseId: true, emailHash: true, phoneHash: true, lmsExportedAt: true, stream: { select: { number: true } } },
  })
}

/** Заказы прошлых загрузок с теми же хешами почты или телефона. */
export async function findOrdersByHashes(hashes: readonly string[]) {
  if (hashes.length === 0) return []
  const list = [...hashes]
  return prisma.siteOrder.findMany({
    where: { OR: [{ emailHash: { in: list } }, { phoneHash: { in: list } }] },
    select: { orderNo: true, emailHash: true, phoneHash: true, lmsExportedAt: true },
  })
}

export interface NewSiteOrder {
  orderNo: string
  courseId: string
  streamNumber: number | null
  emailHash: string
  phoneHash: string | null
  orderedAt: Date | null
}

/**
 * Запись загрузки одной транзакцией: недостающие потоки, затем заказы.
 * `skipDuplicates` — страховка от двойного нажатия: второй запрос с теми же
 * номерами ничего не создаст (уникальный индекс по номеру заявки).
 */
export async function createOrders(
  orders: readonly NewSiteOrder[],
  batchId: string,
  importedById: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const streamIds = new Map<string, string>()
    for (const order of orders) {
      if (order.streamNumber === null) continue
      const key = `${order.courseId}#${order.streamNumber}`
      if (streamIds.has(key)) continue
      const stream = await tx.courseStream.upsert({
        where: { courseId_number: { courseId: order.courseId, number: order.streamNumber } },
        create: { courseId: order.courseId, number: order.streamNumber },
        update: {},
        select: { id: true },
      })
      streamIds.set(key, stream.id)
    }

    const result = await tx.siteOrder.createMany({
      data: orders.map((order) => ({
        orderNo: order.orderNo,
        courseId: order.courseId,
        streamId: order.streamNumber === null ? null : streamIds.get(`${order.courseId}#${order.streamNumber}`)!,
        emailHash: order.emailHash,
        phoneHash: order.phoneHash,
        orderedAt: order.orderedAt,
        importBatchId: batchId,
        importedById,
      })),
      skipDuplicates: true,
    })
    return result.count
  })
}

/** Отмечает заказы как выгруженные в LMS. */
export async function markExportedToLms(orderNos: readonly string[], at: Date): Promise<void> {
  if (orderNos.length === 0) return
  await prisma.siteOrder.updateMany({ where: { orderNo: { in: [...orderNos] } }, data: { lmsExportedAt: at } })
}

// ─────────────────────────── Курсы ───────────────────────────

const courseSelect = {
  id: true,
  name: true,
  description: true,
  isMock: true,
  product: { select: { id: true, name: true, vendor: { select: { id: true, name: true } } } },
  streams: { orderBy: { number: 'asc' }, select: { id: true, number: true, startsAt: true } },
  orders: { select: { streamId: true, emailHash: true, phoneHash: true, orderedAt: true } },
} satisfies Prisma.SchoolCourseSelect

export type CourseRow = Prisma.SchoolCourseGetPayload<{ select: typeof courseSelect }>

export async function findCourses(query: SchoolCourseListQuery): Promise<{ rows: CourseRow[]; total: number }> {
  const where: Prisma.SchoolCourseWhereInput = query.q ? { name: textContains(query.q) } : {}
  const [rows, total] = await Promise.all([
    prisma.schoolCourse.findMany({
      where,
      select: courseSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.schoolCourse.count({ where }),
  ])
  return { rows, total }
}

/** Все заказы — для итога «разных слушателей по всем курсам». Только хеши. */
export async function findAllOrderHashes() {
  return prisma.siteOrder.findMany({ select: { emailHash: true, phoneHash: true } })
}

export async function countStreams(): Promise<number> {
  return prisma.courseStream.count()
}

export async function findCourseById(id: string): Promise<CourseRow | null> {
  return prisma.schoolCourse.findUnique({ where: { id }, select: courseSelect })
}

export async function findCourseByKey(nameKey: string) {
  return prisma.schoolCourse.findUnique({ where: { nameKey }, select: { id: true, name: true } })
}

export async function productExists(id: string): Promise<boolean> {
  return (await prisma.iTProduct.count({ where: { id } })) > 0
}

export async function createCourse(data: Prisma.SchoolCourseUncheckedCreateInput): Promise<CourseRow> {
  return prisma.schoolCourse.create({ data, select: courseSelect })
}
