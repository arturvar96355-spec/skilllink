/**
 * Демо-данные решения 132: вендоры, их продукты и контакты, курсы ИТ-Школы, потоки
 * и заказы с сайта. Отдельным файлом — чтобы общий сид (prisma/seed.ts) менялся
 * тремя строками и не конфликтовал с параллельной правкой демо-набора.
 *
 * Компании и названия продуктов — настоящие (из файла организаторов), контакты —
 * вымышленные, адреса на зарезервированном домене example.invalid. Заказы хранят
 * только хеши вымышленных адресов — как и настоящие.
 */
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '../src/generated/prisma/client'
import { catalogNameKey } from '@/shared/utils/contacts'
import { ORDER_NUMBER_UTC_OFFSET_MINUTES, resolveOrdersHmacKey } from '@/shared/config/enrollment.config'
import { contactHash } from '@/modules/enrollment/enrollment.rules'

/** Удаляет данные решения 132 — до удаления продуктов в общем `clean()`. */
export async function cleanVendorData(prisma: PrismaClient): Promise<void> {
  await prisma.siteOrder.deleteMany()
  await prisma.courseStream.deleteMany()
  await prisma.schoolCourse.deleteMany()
  await prisma.vendorContact.deleteMany()
  await prisma.iTProduct.updateMany({ where: { vendorId: { not: null } }, data: { vendorId: null } })
  await prisma.vendor.deleteMany()
}

interface VendorSeed {
  name: string
  products: Array<{ name: string; category: string }>
  contacts: Array<{
    fullName: string
    phone: string
    email: string
    channels: Array<'EMAIL' | 'TELEGRAM' | 'PHONE'>
    /** По каким продуктам — названия из `products`. */
    products: string[]
  }>
}

/**
 * Пять вендоров и девять продуктов — как в файле организаторов. Категория указана там,
 * где назначение продукта следует из его названия; остальные — «Без категории», как их
 * завела бы загрузка вендоров.
 */
const VENDORS: VendorSeed[] = [
  {
    name: 'ООО «Базис»',
    products: [{ name: 'Базис Dynamix', category: 'Виртуализация' }],
    contacts: [
      { fullName: 'Орлова Вера Николаевна', phone: '+79000000101', email: 'orlova.vn@example.invalid', channels: ['EMAIL', 'TELEGRAM'], products: ['Базис Dynamix'] },
    ],
  },
  {
    name: 'ООО «ТДата»',
    products: [
      { name: 'RT.DataLake', category: 'Данные' },
      { name: 'RT.Warehouse', category: 'Данные' },
    ],
    contacts: [
      { fullName: 'Гусев Павел Олегович', phone: '+79000000102', email: 'gusev.po@example.invalid', channels: ['TELEGRAM'], products: ['RT.DataLake', 'RT.Warehouse'] },
    ],
  },
  {
    name: 'ПАО «Ростелеком»',
    products: [{ name: 'RT.DataVision', category: 'Данные' }],
    contacts: [
      { fullName: 'Белова Ксения Андреевна', phone: '+79000000103', email: 'belova.ka@example.invalid', channels: ['TELEGRAM'], products: ['RT.DataVision'] },
    ],
  },
  {
    name: 'ООО «РТК ИТ Плюс»',
    products: [
      { name: 'AKOLA', category: 'Без категории' },
      { name: 'Яга', category: 'Без категории' },
    ],
    contacts: [
      { fullName: 'Зайцев Роман Ильич', phone: '+79000000104', email: 'zaitsev.ri@example.invalid', channels: ['TELEGRAM'], products: ['AKOLA'] },
      { fullName: 'Мельникова Дарья Сергеевна', phone: '+79000000105', email: 'melnikova.ds@example.invalid', channels: ['TELEGRAM'], products: ['Яга'] },
    ],
  },
  {
    name: 'ООО «РТК ИТ»',
    products: [
      { name: 'Web3Gate', category: 'Без категории' },
      { name: 'Аврора SDK', category: 'Мобильная разработка' },
      { name: 'Нейрошлюз', category: 'Без категории' },
    ],
    contacts: [
      { fullName: 'Кириллов Антон Юрьевич', phone: '+79000000106', email: 'kirillov.au@example.invalid', channels: ['TELEGRAM'], products: ['Web3Gate'] },
      { fullName: 'Фомина Алла Викторовна', phone: '+79000000107', email: 'fomina.av@example.invalid', channels: ['TELEGRAM'], products: ['Аврора SDK'] },
      { fullName: 'Титов Глеб Максимович', phone: '+79000000108', email: 'titov.gm@example.invalid', channels: ['EMAIL'], products: ['Нейрошлюз'] },
    ],
  },
]

/**
 * Вендоры, продукты и контакты. Продукт, который уже есть в сиде (по ключу названия —
 * без кавычек, регистра и пробелов), не дублируется, а привязывается к вендору.
 */
export async function seedVendors(prisma: PrismaClient): Promise<{ vendors: number; products: number; contacts: number }> {
  const existing = await prisma.iTProduct.findMany({ select: { id: true, name: true } })
  const byKey = new Map(existing.map((product) => [catalogNameKey(product.name), product.id]))
  let products = 0
  let contacts = 0

  for (const seed of VENDORS) {
    const vendor = await prisma.vendor.create({
      data: { name: seed.name, nameKey: catalogNameKey(seed.name), isMock: true },
      select: { id: true },
    })
    const productIds = new Map<string, string>()
    for (const product of seed.products) {
      const found = byKey.get(catalogNameKey(product.name))
      const id = found
        ? (await prisma.iTProduct.update({ where: { id: found }, data: { vendorId: vendor.id }, select: { id: true } })).id
        : (
            await prisma.iTProduct.create({
              data: { name: product.name, category: product.category, status: 'ACTIVE', vendorId: vendor.id, isMock: true },
              select: { id: true },
            })
          ).id
      productIds.set(product.name, id)
      byKey.set(catalogNameKey(product.name), id)
      products += 1
    }
    for (const contact of seed.contacts) {
      await prisma.vendorContact.create({
        data: {
          vendorId: vendor.id,
          fullName: contact.fullName,
          phone: contact.phone,
          email: contact.email,
          preferredChannels: contact.channels,
          legalBasis: 'LEGITIMATE_INTEREST',
          basisReference: 'Демо-данные: письмо вендора о контактном лице',
          isMock: true,
          products: { create: contact.products.map((name) => ({ productId: productIds.get(name)! })) },
        },
      })
      contacts += 1
    }
  }
  return { vendors: VENDORS.length, products, contacts }
}

/**
 * Курсы ИТ-Школы — названия из выгрузки сайта организаторов, чтобы их файл
 * заказов загружался на стенде без заведения курсов. К продуктам курсы не привязаны:
 * «на базе программного продукта ПАО «Ростелеком»» не называет, какого именно, —
 * связь ставит сотрудник, а не сид.
 */
const COURSES: Array<{ name: string; streams: number[] }> = [
  { name: 'Анализ данных без программирования', streams: [1, 2] },
  { name: 'Инженер-тестировщик', streams: [1] },
  { name: 'Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»', streams: [1, 2] },
  { name: 'Промпт-инжиниринг', streams: [2, 3] },
  { name: 'Python-разработчик с использованием инструментов ИИ', streams: [3, 4] },
]

/** Демо-заказы: [курс, поток, условный слушатель]. Один слушатель — на двух курсах. */
const DEMO_ORDERS: Array<[number, number, number]> = [
  [0, 1, 1], [0, 1, 2], [0, 1, 3], [0, 2, 4], [0, 2, 5],
  [1, 1, 6], [1, 1, 7], [1, 1, 8],
  [2, 1, 9], [2, 2, 10], [2, 2, 1],
  [3, 2, 11], [3, 3, 12], [3, 3, 12],
  [4, 3, 13], [4, 4, 14], [4, 4, 15], [4, 4, 16],
]

/** Курсы, потоки и заказы с сайта: у заказа — только номер, курс, поток, дата и хеши. */
export async function seedSchoolCourses(prisma: PrismaClient, now: Date): Promise<{ courses: number; orders: number }> {
  // Сид на стенде идёт в промышленном режиме, где ключа у контейнера миграций может
  // не быть. Демо-хешам сравниваться с настоящими незачем — тогда случайный ключ.
  let key: string
  try {
    key = resolveOrdersHmacKey()
  } catch {
    key = randomBytes(32).toString('base64')
  }

  const streamIds: Array<Map<number, string>> = []
  for (const course of COURSES) {
    const row = await prisma.schoolCourse.create({
      data: {
        name: course.name,
        nameKey: catalogNameKey(course.name),
        isMock: true,
        streams: { create: course.streams.map((number) => ({ number })) },
      },
      select: { id: true, streams: { select: { id: true, number: true } } },
    })
    streamIds.push(new Map(row.streams.map((stream) => [stream.number, stream.id])))
  }

  const courses = await prisma.schoolCourse.findMany({ select: { id: true, nameKey: true } })
  const courseId = (index: number) => courses.find((course) => course.nameKey === catalogNameKey(COURSES[index]!.name))!.id

  await prisma.siteOrder.createMany({
    data: DEMO_ORDERS.map(([course, stream, listener], index) => {
      const orderedAt = new Date(now.getTime() - (DEMO_ORDERS.length - index) * 3 * 24 * 3600_000)
      // Дата в номере — по Москве, как пишет сайт (ORDER_NUMBER_UTC_OFFSET_MINUTES).
      const local = new Date(orderedAt.getTime() + ORDER_NUMBER_UTC_OFFSET_MINUTES * 60_000)
      const stamp = local.toISOString().replace(/\D/g, '').slice(0, 14)
      return {
        orderNo: `ORD-${stamp}-DEMO${String(index + 1).padStart(2, '0')}`,
        courseId: courseId(course),
        streamId: streamIds[course]!.get(stream)!,
        emailHash: contactHash(key, 'email', `listener${listener}@example.invalid`),
        phoneHash: contactHash(key, 'phone', `790000002${String(listener).padStart(2, '0')}`),
        orderedAt,
        importBatchId: 'seed',
        isMock: true,
      }
    }),
  })
  return { courses: COURSES.length, orders: DEMO_ORDERS.length }
}
