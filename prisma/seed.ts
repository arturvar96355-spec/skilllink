/**
 * Демонстрационные данные SkillLink.
 *
 * Все записи помечены isMock = true: система обязана показывать, что это демо,
 * и никогда не выдавать эти цифры за подтверждённую статистику (раздел 4 ТЗ).
 * Персональные данные вымышленные.
 *
 * Запуск: npm run db:seed
 */
import 'dotenv/config'
import { hash } from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { generate as generateRecommendations } from '@/modules/recommendations/recommendations.service'
import { seedRecommendationStats } from '@/modules/recommendations/recommendations.seed'
import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { ANONYMIZED_CONTACT_FIELDS } from '@/modules/universities/universities.rules'
import { auditSeal } from '@/modules/audit/chain.service'
import { runTraining as trainForecastModels } from '@/modules/analytics/forecast.service'
import { eraseUser, exportOwnData, registerRequest } from '@/modules/dsar/dsar.service'
import { approve as approveApproval, request as requestApproval } from '@/modules/approvals/approvals.service'
import { dismiss as dismissDuplicate, findDuplicates } from '@/modules/data-quality/data-quality.service'
import { merge as mergeUniversities, undo as undoUniversityMerge } from '@/modules/universities/merge.service'
import type { CurrentUser } from '@/shared/auth/current-user'
import { PrismaClient } from '../src/generated/prisma/client'
import { WORKFLOW_STAGES } from '../src/shared/config/workflow.config'
import { cleanVendorData, seedSchoolCourses, seedVendors } from './seed-vendors'
import { DEFAULT_STABLE_UNTIL, generateDemoData } from './demo/generate'
import { insertExtendedDemo, insertResolvedRecommendations } from './demo/insert'
import { validInn, validOgrn } from './demo/random'
import { BASE_SKILLS, fillProgramSkills } from './demo/catalog'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Не задана переменная окружения DATABASE_URL')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const DAY = 24 * 60 * 60 * 1000
/**
 * Якорная дата: все даты демо-набора считаются от момента заливки (решение 85),
 * поэтому набор не стареет между перезаливками.
 */
const now = new Date()
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY)
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY)

/**
 * До какой даты стенд не должен «протухать» (решение 131): будущие сроки и следующие
 * шаги сдвигаются за неё, прошедшие остаются на месте. По умолчанию — конец
 * экспертизы; для следующего показа — SEED_STABLE_UNTIL (ISO-дата).
 */
function parseStableUntil(): Date {
  const raw = process.env.SEED_STABLE_UNTIL?.trim()
  if (!raw) return DEFAULT_STABLE_UNTIL
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`SEED_STABLE_UNTIL не дата: ${raw}`)
  return parsed
}
const STABLE_UNTIL = parseStableUntil()
const STABLE_SHIFT = Math.max(0, STABLE_UNTIL.getTime() - now.getTime())
/** Будущая дата — за окно стабильности; прошедшая не меняется. */
const stabilize = (date: Date) => (date > now ? new Date(date.getTime() + STABLE_SHIFT) : date)

/** Вуз, у которого в демо есть представитель в кабинете (rep@spbgu.example.invalid). */
const UNIVERSITY_WITH_REP = 'spbgu'

/**
 * Сроки этапов после начала занятий, дней от него: 11 «Проведение занятий»,
 * 12 «Обновление документации», 13 «Повышение квалификации», 14 «Контроль».
 * Только для демо-набора, в самой системе сроки считаются по нормативам (TEMP).
 */
const DAYS_AFTER_CLASSES_START: Partial<Record<number, number>> = { 11: 30, 12: 60, 13: 90, 14: 120 }

/** Порядок важен: сначала зависимые таблицы. */
async function clean(): Promise<void> {
  await cleanVendorData(prisma)
  // Журнал, его печати и точки чистки только дописываются (решение 115): перезаливка
  // демо — осознанный обход, одной транзакцией. Цепочка начинается заново с № 1,
  // печати прежнего журнала вместе с ним теряют смысл и удаляются.
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('skilllink.allow_audit_purge', 'on', true)`,
    prisma.auditLog.deleteMany(),
    prisma.auditSeal.deleteMany(),
    prisma.auditChainCut.deleteMany(),
  ])
  await prisma.universityMerge.deleteMany()
  await prisma.duplicateDismissal.deleteMany()
  // Прогноз (решение 135, решение 141): version растёт при каждом обучении той же
  // вехи (не привязан к числу строк) — без чистки перезаливка не была бы детерминированной.
  await prisma.forecastModel.deleteMany()
  await prisma.contactBasisHistory.deleteMany()
  await prisma.stageHistory.deleteMany()
  await prisma.task.deleteMany()
  await prisma.workflowStage.deleteMany()
  await prisma.documentHistory.deleteMany()
  await prisma.document.deleteMany()
  await prisma.meetingParticipant.deleteMany()
  await prisma.meeting.deleteMany()
  await prisma.recommendationSignal.deleteMany()
  await prisma.recommendation.deleteMany()
  await prisma.application.deleteMany()
  await prisma.cooperation.deleteMany()
  await prisma.programSkill.deleteMany()
  await prisma.productSkill.deleteMany()
  await prisma.marketDemand.deleteMany()
  await prisma.educationalProgram.deleteMany()
  await prisma.contact.deleteMany()
  await prisma.iTProduct.deleteMany()
  await prisma.skill.deleteMany()
  await prisma.dataSource.deleteMany()
  await prisma.user.updateMany({ data: { universityId: null } })
  await prisma.university.deleteMany()
  // Одобрения и реестр запросов субъектов ссылаются на пользователей (RESTRICT) — до них.
  await prisma.approval.deleteMany()
  await prisma.dsarRequest.deleteMany()
  await prisma.user.deleteMany()
}

/** Поиск id записи по естественному ключу: имени навыка, ключу вуза или программы. */
type IdOf = (key: string) => string

/** Созданная связка: по ключу «вуз-программа» на неё ссылаются документы, встречи и рекомендации. */
interface CreatedCooperation {
  key: string
  id: string
  universityKey: string
}

/** Сотрудники ИТ-Школы. Представитель вуза создаётся позже — ему нужен свой вуз. */
async function seedUsers() {
  console.log('Пользователи...')

  // Демонстрационный пароль один на всех: это стенд, а не промышленный контур.
  // Хеш считается один раз — bcrypt намеренно медленный.
  //
  // На стенде с публичным адресом пароль задаётся через SEED_DEMO_PASSWORD:
  // «skilllink» записан в документации, и любой её читатель вошёл бы
  // администратором и испортил данные перед показом.
  const customPassword = process.env.SEED_DEMO_PASSWORD?.trim()
  const DEMO_PASSWORD = customPassword || 'skilllink'
  const demoPasswordHash = await hash(DEMO_PASSWORD, 10)
  const admin = await prisma.user.create({
    data: {
      email: 'admin@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Демидова Анна Сергеевна',
      position: 'Администратор системы',
      role: 'ADMIN',
    },
  })
  const manager = await prisma.user.create({
    data: {
      email: 'manager@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Кириллов Пётр Андреевич',
      position: 'Менеджер партнёрств ИТ-Школы',
      role: 'MANAGER',
    },
  })
  const manager2 = await prisma.user.create({
    data: {
      email: 'manager2@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Савельева Ольга Дмитриевна',
      position: 'Менеджер партнёрств ИТ-Школы',
      role: 'MANAGER',
    },
  })
  const analyst = await prisma.user.create({
    data: {
      email: 'analyst@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Орлов Михаил Юрьевич',
      position: 'Аналитик',
      role: 'ANALYST',
    },
  })
  await prisma.user.create({
    data: {
      email: 'viewer@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Лебедева Анна Сергеевна',
      position: 'Руководитель направления',
      role: 'VIEWER',
    },
  })
  // Второй администратор — «четыре глаза» для approvals (решение 133): одобрить
  // операцию должен кто-то, кроме запросившего, а на стенде был только один admin.
  const admin2 = await prisma.user.create({
    data: {
      email: 'admin2@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Соловьёва Марина Дмитриевна',
      position: 'Администратор системы (ИБ)',
      role: 'ADMIN',
    },
  })
  // Уволенный сотрудник — только для примера обезличивания по DSAR (решение 116,
  // решение 141): без открытой работы (связок, этапов), поэтому eraseUser его пропустит.
  const formerEmployee = await prisma.user.create({
    data: {
      email: 'former.employee@skilllink.demo',
      passwordHash: demoPasswordHash,
      fullName: 'Куликов Станислав Егорович',
      position: 'Бывший менеджер партнёрств',
      role: 'VIEWER',
      isActive: false,
    },
  })
  return { customPassword, DEMO_PASSWORD, demoPasswordHash, admin, admin2, manager, manager2, analyst, formerEmployee }
}

type SeedUsers = Awaited<ReturnType<typeof seedUsers>>
type SeedUser = SeedUsers['manager']

/** Источник рыночных данных — демонстрационный набор вакансий. */
async function seedDataSources() {
  console.log('Источники данных...')
  const mockSource = await prisma.dataSource.create({
    data: {
      name: 'Демонстрационный набор вакансий',
      type: 'MOCK',
      collectionDate: daysAgo(30),
      reliability: 'LOW',
      description:
        'Подготовленный вручную набор для демонстрации. Автоматический сбор не реализован.',
      isMock: true,
    },
  })
  return mockSource
}

/** Справочник навыков. Возвращает поиск id навыка по имени. */
async function seedSkills(): Promise<IdOf> {
  console.log('Навыки...')
  const skills = new Map<string, string>()
  for (const item of BASE_SKILLS) {
    const created = await prisma.skill.create({ data: item })
    skills.set(item.name, created.id)
  }
  const skillId = (name: string): string => {
    const id = skills.get(name)
    if (!id) throw new Error(`Навык не найден: ${name}`)
    return id
  }
  return skillId
}

// Рыночная востребованность навыков основного сида (2025-Q3…2026-Q3) заливается
// вместе с расширенным набором — insertExtendedDemo() (решение 141): один источник
// чисел, EXTRA_MARKET в prisma/demo/catalog.ts, вместо двух копий по кварталам.

/** IT-продукты ИТ-Школы с навыками, во всех статусах жизненного цикла. */
async function seedProducts(skillId: IdOf) {
  // Даты — по сюжету: продукты ИТ-Школы заведены задолго до первой связки,
  // «обновлён» — выпуск текущей версии.
  console.log('IT-продукты...')
  const products = {
    cloud: await prisma.iTProduct.create({
      data: {
        name: 'Облачная платформа РТК',
        category: 'Облачные сервисы',
        description: 'Платформа развёртывания приложений в контуре заказчика.',
        documentationUrl: 'https://example.invalid/docs/cloud',
        version: '3.2',
        status: 'ACTIVE',
        isMock: true,
        createdAt: daysAgo(540),
        updatedAt: daysAgo(60),
        skills: {
          create: [
            { skillId: skillId('Облачные платформы'), relevance: 'CORE' },
            { skillId: skillId('Docker'), relevance: 'CORE' },
            { skillId: skillId('Kubernetes'), relevance: 'RELATED' },
            { skillId: skillId('Linux'), relevance: 'RELATED' },
          ],
        },
      },
    }),
    security: await prisma.iTProduct.create({
      data: {
        name: 'Система мониторинга безопасности',
        category: 'Информационная безопасность',
        description: 'Мониторинг событий безопасности и реагирование на инциденты.',
        documentationUrl: 'https://example.invalid/docs/security',
        version: '2.0',
        status: 'ACTIVE',
        isMock: true,
        createdAt: daysAgo(540),
        updatedAt: daysAgo(150),
        skills: {
          create: [
            { skillId: skillId('Информационная безопасность'), relevance: 'CORE' },
            { skillId: skillId('Сетевые технологии'), relevance: 'CORE' },
            { skillId: skillId('Linux'), relevance: 'RELATED' },
          ],
        },
      },
    }),
    dataLab: await prisma.iTProduct.create({
      data: {
        name: 'Аналитическая платформа данных',
        category: 'Обработка данных',
        description: 'Хранилище и инструменты анализа данных для учебных курсов.',
        documentationUrl: 'https://example.invalid/docs/data',
        version: '1.7',
        status: 'ACTIVE',
        isMock: true,
        createdAt: daysAgo(540),
        updatedAt: daysAgo(90),
        skills: {
          create: [
            { skillId: skillId('Аналитика данных'), relevance: 'CORE' },
            { skillId: skillId('SQL'), relevance: 'CORE' },
            { skillId: skillId('PostgreSQL'), relevance: 'RELATED' },
            { skillId: skillId('Машинное обучение'), relevance: 'OPTIONAL' },
          ],
        },
      },
    }),
    devops: await prisma.iTProduct.create({
      data: {
        name: 'Конвейер сборки и поставки',
        category: 'DevOps',
        description: 'Инструменты непрерывной интеграции для учебных проектов.',
        documentationUrl: 'https://example.invalid/docs/devops',
        version: '4.1',
        status: 'ACTIVE',
        isMock: true,
        createdAt: daysAgo(540),
        updatedAt: daysAgo(30),
        skills: {
          create: [
            { skillId: skillId('CI/CD'), relevance: 'CORE' },
            { skillId: skillId('Docker'), relevance: 'CORE' },
            { skillId: skillId('Тестирование ПО'), relevance: 'RELATED' },
          ],
        },
      },
    }),
    // Весь жизненный цикл продукта, а не только «действует»: планируемый ещё нельзя
    // предлагать вузам, выводимый — только доживает в открытых связках.
    labs: await prisma.iTProduct.create({
      data: {
        name: 'Платформа виртуальных лабораторий',
        category: 'Учебная инфраструктура',
        description: 'Лабораторные стенды в браузере для практикумов по сетям и Linux. Выпуск запланирован на весну.',
        documentationUrl: null,
        version: null,
        status: 'PLANNED',
        isMock: true,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(12),
        skills: {
          create: [
            { skillId: skillId('Linux'), relevance: 'CORE' },
            { skillId: skillId('Сетевые технологии'), relevance: 'RELATED' },
          ],
        },
      },
    }),
    legacyNet: await prisma.iTProduct.create({
      data: {
        name: 'Учебный стенд сетей передачи данных',
        category: 'Учебная инфраструктура',
        description: 'Прежнее поколение сетевого стенда. Выводится: новым вузам не предлагается, поддержка до конца учебного года.',
        documentationUrl: 'https://example.invalid/docs/netlab-v1',
        version: '1.4',
        status: 'DEPRECATED',
        isMock: true,
        createdAt: daysAgo(900),
        updatedAt: daysAgo(90),
        skills: {
          create: [{ skillId: skillId('Сетевые технологии'), relevance: 'CORE' }],
        },
      },
    }),
  }
  return products
}

type SeedProducts = Awaited<ReturnType<typeof seedProducts>>

/** Вузы с основным контактом. Возвращает поиск id вуза по ключу и даты заведения вузов. */
async function seedUniversities() {
  console.log('Вузы, контакты и программы...')
  const universitySeed = [
    {
      key: 'spbgu',
      createdDaysAgo: 240, updatedDaysAgo: 14,
      name: 'Санкт-Петербургский государственный университет телекоммуникаций',
      shortName: 'СПбГУТ',
      city: 'Санкт-Петербург',
      region: 'Санкт-Петербург',
      status: 'ACTIVE' as const,
      directionCount: 24,
      studentCount: 11800,
      contact: { fullName: 'Ветрова Ирина Павловна', position: 'Заместитель декана' },
    },
    {
      key: 'mtuci',
      createdDaysAgo: 120, updatedDaysAgo: 40,
      name: 'Московский технический университет связи и информатики',
      shortName: 'МТУСИ',
      city: 'Москва',
      region: 'Москва',
      status: 'ACTIVE' as const,
      directionCount: 19,
      studentCount: 9200,
      contact: { fullName: 'Гаврилов Сергей Олегович', position: 'Заведующий кафедрой' },
    },
    {
      key: 'kazan',
      createdDaysAgo: 430, updatedDaysAgo: 45,
      name: 'Казанский национальный исследовательский технический университет',
      shortName: 'КНИТУ-КАИ',
      city: 'Казань',
      region: 'Республика Татарстан',
      status: 'IN_PROGRESS' as const,
      directionCount: 31,
      studentCount: 14300,
      contact: { fullName: 'Нуриева Алия Рустамовна', position: 'Начальник учебного отдела' },
    },
    {
      key: 'nsu',
      createdDaysAgo: 90, updatedDaysAgo: 70,
      name: 'Новосибирский государственный технический университет',
      shortName: 'НГТУ',
      city: 'Новосибирск',
      region: 'Новосибирская область',
      status: 'IN_PROGRESS' as const,
      directionCount: 27,
      studentCount: 12600,
      contact: { fullName: 'Белых Андрей Валентинович', position: 'Доцент кафедры' },
    },
    {
      key: 'urfu',
      createdDaysAgo: 12, updatedDaysAgo: 5,
      name: 'Уральский федеральный университет',
      shortName: 'УрФУ',
      city: 'Екатеринбург',
      region: 'Свердловская область',
      status: 'NEW' as const,
      directionCount: 45,
      studentCount: 35000,
      contact: { fullName: 'Зайцева Марина Львовна', position: 'Руководитель направления' },
    },
    {
      key: 'rostov',
      createdDaysAgo: 300, updatedDaysAgo: 180,
      name: 'Донской государственный технический университет',
      shortName: 'ДГТУ',
      city: 'Ростов-на-Дону',
      region: 'Ростовская область',
      status: 'PAUSED' as const,
      directionCount: 22,
      studentCount: 16400,
      contact: { fullName: 'Петренко Виктор Иванович', position: 'Проректор по развитию' },
    },
    {
      // Вуз в архиве: переговоры год назад не пошли дальше знакомства. В реестре
      // виден по фильтру «В архиве», в рейтинг и аналитику не входит.
      key: 'tomsk',
      createdDaysAgo: 420, updatedDaysAgo: 330,
      name: 'Томский государственный университет систем управления и радиоэлектроники',
      shortName: 'ТУСУР',
      city: 'Томск',
      region: 'Томская область',
      status: 'ARCHIVED' as const,
      directionCount: 18,
      studentCount: 13500,
      contact: { fullName: 'Орлов Дмитрий Сергеевич', position: 'Начальник отдела партнёрств' },
    },
  ]

  // Даты записи — по сюжету, а не момент заливки: вуз заведён до первой связки с ним.
  const universities = new Map<string, string>()
  const universityCreatedAt = new Map<string, Date>()
  for (const item of universitySeed) {
    const createdAt = daysAgo(item.createdDaysAgo)
    universityCreatedAt.set(item.key, createdAt)
    const created = await prisma.university.create({
      data: {
        createdAt,
        updatedAt: daysAgo(item.updatedDaysAgo),
        name: item.name,
        shortName: item.shortName,
        city: item.city,
        region: item.region,
        address: `${item.city}, адрес указан условно`,
        website: `https://example.invalid/${item.key}`,
        // ИНН/ОГРН — решение 134: контрольная сумма верна (prisma/demo/random.ts),
        // сама организация в реестре ФНС не проверяется.
        inn: validInn(item.key),
        ogrn: validOgrn(item.key),
        status: item.status,
        // Архив — это и статус, и дата: по дате архивный вуз исключается из аналитики.
        archivedAt: item.status === 'ARCHIVED' ? daysAgo(item.updatedDaysAgo) : null,
        directionCount: item.directionCount,
        studentCount: item.studentCount,
        description: 'Демонстрационная запись. Показатели не являются подтверждённой статистикой.',
        isMock: true,
        contacts: {
          create: [
            {
              fullName: item.contact.fullName,
              position: item.contact.position,
              email: `contact@${item.key}.example.invalid`,
              phone: '+7 900 000-00-00',
              isPrimary: true,
              createdAt,
              updatedAt: createdAt,
            },
          ],
        },
      },
    })
    universities.set(item.key, created.id)
  }
  const universityId = (key: string): string => {
    const id = universities.get(key)
    if (!id) throw new Error(`Вуз не найден: ${key}`)
    return id
  }
  return { universityId, universityCreatedAt }
}

/**
 * Правовые основания обработки ПД демо-контактов (решение 111): каждый вариант,
 * который увидит зритель в карточке вуза.
 *
 * - Четыре вуза — законный интерес по соглашению с вузом (п. 7 ч. 1 ст. 6):
 *   основной случай по docs/PRIVACY.md, раздел 3.
 * - УрФУ и ДГТУ — согласие получено (электронное и письменное).
 * - ТУСУР (в архиве) — основание не зафиксировано: переговоры закончились
 *   до учёта оснований, так бывает и с реальными данными.
 * - В ДГТУ второй, не основной контакт отозвал согласие — и обезличен. Не основной
 *   и не в вузе со встречами: сценарий показа и встречи его не касаются.
 *
 * История — как если бы основание фиксировал менеджер; журнал действий сид не пишет.
 */
async function seedContactBases(
  manager: SeedUser,
  universityId: IdOf,
  universityCreatedAt: ReadonlyMap<string, Date>,
): Promise<void> {
  console.log('Основания обработки ПД контактов...')
  const plan: Array<{
    key: string
    basis: 'LEGITIMATE_INTEREST' | 'CONSENT'
    form?: 'WRITTEN' | 'ELECTRONIC'
    reference: string
  }> = [
    { key: 'spbgu', basis: 'LEGITIMATE_INTEREST', reference: 'Соглашение о сотрудничестве № 14/2026 (демо), архив договоров' },
    { key: 'mtuci', basis: 'LEGITIMATE_INTEREST', reference: 'Соглашение о сотрудничестве № 21/2026 (демо), архив договоров' },
    { key: 'kazan', basis: 'LEGITIMATE_INTEREST', reference: 'Соглашение о сотрудничестве № 3/2025 (демо), архив договоров' },
    { key: 'nsu', basis: 'LEGITIMATE_INTEREST', reference: 'Соглашение о сотрудничестве № 27/2026 (демо), архив договоров' },
    { key: 'urfu', basis: 'CONSENT', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 118/2026 (демо)' },
    { key: 'rostov', basis: 'CONSENT', form: 'WRITTEN', reference: 'Согласие вх. № 64/2025 (демо), папка «Согласия ПД»' },
  ]

  for (const item of plan) {
    const since = universityCreatedAt.get(item.key)
    if (!since) throw new Error(`Нет даты заведения вуза: ${item.key}`)
    const contact = await prisma.contact.findFirstOrThrow({
      where: { universityId: universityId(item.key), isPrimary: true },
      select: { id: true },
    })
    const consent = item.basis === 'CONSENT'
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        legalBasis: item.basis,
        consentStatus: consent ? 'OBTAINED' : 'NONE',
        consentObtainedAt: consent ? since : null,
        consentForm: consent ? (item.form ?? null) : null,
        basisReference: item.reference,
        basisUpdatedAt: since,
      },
    })
    await prisma.contactBasisHistory.create({
      data: {
        contactId: contact.id,
        fromBasis: null,
        toBasis: item.basis,
        fromConsentStatus: 'NONE',
        toConsentStatus: consent ? 'OBTAINED' : 'NONE',
        consentObtainedAt: consent ? since : null,
        consentForm: consent ? (item.form ?? null) : null,
        referenceChanged: true,
        changedById: manager.id,
        changedAt: since,
      },
    })
  }

  // Отозванное согласие: контакт уже обезличен тем же набором полей, что и в приложении.
  const obtainedAt = daysAgo(200)
  const withdrawnAt = daysAgo(20)
  const withdrawn = await prisma.contact.create({
    data: {
      universityId: universityId('rostov'),
      ...ANONYMIZED_CONTACT_FIELDS,
      legalBasis: 'CONSENT',
      consentStatus: 'WITHDRAWN',
      consentObtainedAt: obtainedAt,
      consentForm: 'ORAL_CONFIRMED_BY_EMAIL',
      consentWithdrawnAt: withdrawnAt,
      basisReference: 'Письмо-подтверждение вх. № 71/2026 (демо)',
      withdrawalReference: 'Отзыв согласия, письмо вх. № 212/2026 (демо)',
      basisUpdatedAt: withdrawnAt,
      createdAt: obtainedAt,
      updatedAt: withdrawnAt,
    },
    select: { id: true },
  })
  await prisma.contactBasisHistory.createMany({
    data: [
      {
        contactId: withdrawn.id,
        fromBasis: null,
        toBasis: 'CONSENT',
        fromConsentStatus: 'NONE',
        toConsentStatus: 'OBTAINED',
        consentObtainedAt: obtainedAt,
        consentForm: 'ORAL_CONFIRMED_BY_EMAIL',
        referenceChanged: true,
        changedById: manager.id,
        changedAt: obtainedAt,
      },
      {
        contactId: withdrawn.id,
        fromBasis: 'CONSENT',
        toBasis: 'CONSENT',
        fromConsentStatus: 'OBTAINED',
        toConsentStatus: 'WITHDRAWN',
        consentObtainedAt: obtainedAt,
        consentForm: 'ORAL_CONFIRMED_BY_EMAIL',
        consentWithdrawnAt: withdrawnAt,
        referenceChanged: true,
        anonymized: true,
        changedById: manager.id,
        changedAt: withdrawnAt,
      },
    ],
  })
}

/**
 * Второй контакт у вузов основного сида (решение 141): у каждого вуза — 2–3 контакта
 * с правовым основанием (решение 111), а не один. ТУСУР — исключение по сюжету:
 * у его единственного прежнего контакта основание намеренно не зафиксировано
 * (см. seedContactBases), второй контакт добавлен позже, когда учёт уже вели.
 *
 * Основания подобраны так, чтобы в демо встретились и «Договор» (CONTRACT).
 * и «Иное» (OTHER) — до этого решения ни один демо-контакт их не использовал.
 */
async function seedSecondaryContacts(manager: SeedUser, universityId: IdOf, universityCreatedAt: ReadonlyMap<string, Date>): Promise<void> {
  console.log('Вторые контакты вузов основного сида...')
  interface SecondContactPlan {
    key: string
    fullName: string
    position: string
    mailbox: string
    phone: string
    basis:
      | { kind: 'LEGITIMATE_INTEREST'; reference: string }
      | { kind: 'CONSENT'; form: 'WRITTEN' | 'ELECTRONIC' | 'ORAL_CONFIRMED_BY_EMAIL'; reference: string }
      | { kind: 'CONTRACT'; reference: string }
      | { kind: 'OTHER'; reference: string }
  }
  const plan: SecondContactPlan[] = [
    { key: 'spbgu', fullName: 'Фадеев Григорий Андреевич', position: 'Специалист приёмной комиссии', mailbox: 'admissions', phone: '+7 900 000-01-01',
      basis: { kind: 'LEGITIMATE_INTEREST', reference: 'Соглашение о сотрудничестве № 14/2026 (демо), архив договоров' } },
    { key: 'mtuci', fullName: 'Панова Ксения Романовна', position: 'Менеджер по работе с партнёрами', mailbox: 'partners', phone: '+7 900 000-01-02',
      basis: { kind: 'CONSENT', form: 'ELECTRONIC', reference: 'Электронное согласие, письмо вх. № 145/2026 (демо)' } },
    { key: 'kazan', fullName: 'Хабибуллин Ринат Маратович', position: 'Приглашённый эксперт по договору ГПХ', mailbox: 'expert', phone: '+7 900 000-01-03',
      basis: { kind: 'CONTRACT', reference: 'Договор возмездного оказания услуг № 9/2026 (демо), приложение «Контактные лица»' } },
    { key: 'nsu', fullName: 'Дорофеева Александра Игоревна', position: 'Куратор цифровой кафедры', mailbox: 'digital-dept', phone: '+7 900 000-01-04',
      basis: { kind: 'OTHER', reference: 'Регламент взаимодействия с индустриальными партнёрами, п. 4.2 (демо)' } },
    { key: 'urfu', fullName: 'Костенко Вадим Олегович', position: 'Специалист по цифровым кафедрам', mailbox: 'digital', phone: '+7 900 000-01-05',
      basis: { kind: 'LEGITIMATE_INTEREST', reference: 'Соглашение о намерениях № 52/2026 (демо), архив договоров' } },
    { key: 'tomsk', fullName: 'Малышев Егор Викторович', position: 'Специалист отдела партнёрств', mailbox: 'partnership', phone: '+7 900 000-01-06',
      basis: { kind: 'CONSENT', form: 'WRITTEN', reference: 'Согласие вх. № 12/2026 (демо), папка «Согласия ПД»' } },
  ]

  for (const item of plan) {
    const since = universityCreatedAt.get(item.key)
    if (!since) throw new Error(`Нет даты заведения вуза: ${item.key}`)
    const consent = item.basis.kind === 'CONSENT'
    const consentForm = item.basis.kind === 'CONSENT' ? item.basis.form : null
    const created = await prisma.contact.create({
      data: {
        universityId: universityId(item.key),
        fullName: item.fullName,
        position: item.position,
        email: `${item.mailbox}@${item.key}.example.invalid`,
        phone: item.phone,
        isPrimary: false,
        createdAt: since,
        updatedAt: since,
        legalBasis: item.basis.kind,
        consentStatus: consent ? 'OBTAINED' : 'NONE',
        consentObtainedAt: consent ? since : null,
        consentForm,
        basisReference: item.basis.reference,
        basisUpdatedAt: since,
      },
      select: { id: true },
    })
    await prisma.contactBasisHistory.create({
      data: {
        contactId: created.id,
        fromBasis: null,
        toBasis: item.basis.kind,
        fromConsentStatus: 'NONE',
        toConsentStatus: consent ? 'OBTAINED' : 'NONE',
        consentObtainedAt: consent ? since : null,
        consentForm,
        referenceChanged: true,
        changedById: manager.id,
        changedAt: since,
      },
    })
  }
}

/** Программы демо-набора. У части показатели намеренно не заполнены — проверка поведения «Нет данных». */
const programSeed = [
  {
    key: 'spbgu-infosec', university: 'spbgu',
    name: 'Информационная безопасность телекоммуникационных систем',
    code: '10.03.01', direction: 'Информационная безопасность',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 310, studentCount: 124, groupCount: 5,
    skills: [
      ['Информационная безопасность', 'ADVANCED', 'CRITICAL'],
      ['Сетевые технологии', 'ADVANCED', 'HIGH'],
      ['Linux', 'INTERMEDIATE', 'HIGH'],
      ['Python', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'spbgu-soft', university: 'spbgu',
    name: 'Программная инженерия',
    code: '09.03.04', direction: 'Информатика и вычислительная техника',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 420, studentCount: 180, groupCount: 7,
    skills: [
      ['Java', 'ADVANCED', 'CRITICAL'],
      ['SQL', 'INTERMEDIATE', 'HIGH'],
      ['Тестирование ПО', 'INTERMEDIATE', 'MEDIUM'],
      ['Микросервисы', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'mtuci-cloud', university: 'mtuci',
    name: 'Облачные технологии и инфраструктура',
    code: '09.04.01', direction: 'Информатика и вычислительная техника',
    level: 'MASTER' as const, durationMonths: 24,
    applicationCount: 190, studentCount: 76, groupCount: 3,
    skills: [
      ['Облачные платформы', 'ADVANCED', 'CRITICAL'],
      ['Docker', 'ADVANCED', 'HIGH'],
      ['Linux', 'INTERMEDIATE', 'HIGH'],
    ] as const,
  },
  {
    key: 'mtuci-data', university: 'mtuci',
    name: 'Анализ данных в телекоммуникациях',
    code: '01.03.02', direction: 'Прикладная математика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 260, studentCount: 98, groupCount: 4,
    skills: [
      ['Аналитика данных', 'ADVANCED', 'CRITICAL'],
      ['Python', 'ADVANCED', 'CRITICAL'],
      ['SQL', 'INTERMEDIATE', 'HIGH'],
    ] as const,
  },
  {
    key: 'kazan-devops', university: 'kazan',
    name: 'Инженерия программного обеспечения и DevOps',
    code: '09.03.04', direction: 'Информатика и вычислительная техника',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 205, studentCount: 88, groupCount: 3,
    skills: [
      ['CI/CD', 'INTERMEDIATE', 'HIGH'],
      ['Docker', 'INTERMEDIATE', 'HIGH'],
      ['JavaScript', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'kazan-networks', university: 'kazan',
    name: 'Сети связи и системы коммутации',
    code: '11.03.02', direction: 'Инфокоммуникационные технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    // Показатели не заполнены: сотрудничество ещё не начато.
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Сетевые технологии', 'ADVANCED', 'CRITICAL'],
      ['Linux', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'nsu-ai', university: 'nsu',
    name: 'Искусственный интеллект и машинное обучение',
    code: '02.04.02', direction: 'Фундаментальная информатика',
    level: 'MASTER' as const, durationMonths: 24,
    applicationCount: 150, studentCount: 52, groupCount: 2,
    skills: [
      ['Машинное обучение', 'ADVANCED', 'CRITICAL'],
      ['Python', 'ADVANCED', 'CRITICAL'],
      ['Аналитика данных', 'INTERMEDIATE', 'HIGH'],
    ] as const,
  },
  {
    key: 'nsu-soft', university: 'nsu',
    name: 'Разработка информационных систем',
    code: '09.03.02', direction: 'Информационные системы и технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 280, studentCount: null, groupCount: 4,
    skills: [
      ['JavaScript', 'INTERMEDIATE', 'HIGH'],
      ['SQL', 'INTERMEDIATE', 'HIGH'],
      ['Бизнес-анализ', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'urfu-security', university: 'urfu',
    name: 'Компьютерная безопасность',
    code: '10.05.01', direction: 'Информационная безопасность',
    level: 'SPECIALIST' as const, durationMonths: 66,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Информационная безопасность', 'INTERMEDIATE', 'CRITICAL'],
      ['Сетевые технологии', 'BASIC', 'HIGH'],
    ] as const,
  },
  {
    key: 'rostov-it', university: 'rostov',
    name: 'Информационные технологии и управление',
    code: '09.03.03', direction: 'Прикладная информатика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 175, studentCount: 64, groupCount: 2,
    skills: [
      ['Управление проектами', 'INTERMEDIATE', 'MEDIUM'],
      ['SQL', 'BASIC', 'MEDIUM'],
      ['Бизнес-анализ', 'INTERMEDIATE', 'HIGH'],
    ] as const,
  },
  // Программы не только «действует»: черновик, приостановленная и архивная видны
  // в реестре со своим статусом, но в рейтинг, дефициты и рекомендации не входят
  // (ACTIVE_PROGRAM_WHERE) — показатели набора у них не заполнены.
  {
    key: 'urfu-gamedev', university: 'urfu', status: 'DRAFT' as const,
    name: 'Технологии разработки компьютерных игр',
    code: '09.03.04', direction: 'Программная инженерия',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Python', 'INTERMEDIATE', 'HIGH'],
      ['JavaScript', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'rostov-networks', university: 'rostov', status: 'SUSPENDED' as const,
    name: 'Инфокоммуникационные технологии и системы связи',
    code: '11.03.02', direction: 'Инфокоммуникационные технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Сетевые технологии', 'ADVANCED', 'CRITICAL'],
      ['Linux', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'nsu-embedded', university: 'nsu', status: 'ARCHIVED' as const,
    name: 'Встраиваемые системы',
    code: '09.04.01', direction: 'Информатика и вычислительная техника',
    level: 'MASTER' as const, durationMonths: 24,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Linux', 'ADVANCED', 'HIGH'],
      ['Python', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  // Решение 141: 4–7 связок на вуз (было 1–2) — программы общих направлений,
  // те же коды ФГОС, что и у остальных вузов (сеть, а не звезда уникальных программ).
  {
    key: 'mtuci-isit', university: 'mtuci',
    name: 'Информационные системы и технологии',
    code: '09.03.02', direction: 'Информационные системы и технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 210, studentCount: 88, groupCount: 3,
    skills: [
      ['JavaScript', 'INTERMEDIATE', 'HIGH'],
      ['SQL', 'INTERMEDIATE', 'HIGH'],
    ] as const,
  },
  {
    key: 'mtuci-networks', university: 'mtuci',
    name: 'Инфокоммуникационные технологии и системы связи',
    code: '11.03.02', direction: 'Инфокоммуникационные технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 195, studentCount: 80, groupCount: 3,
    skills: [
      ['Сетевые технологии', 'INTERMEDIATE', 'HIGH'],
      ['Linux', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'mtuci-appl', university: 'mtuci',
    name: 'Прикладная информатика',
    code: '09.03.03', direction: 'Прикладная информатика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 180, studentCount: 74, groupCount: 3,
    skills: [
      ['Аналитика данных', 'INTERMEDIATE', 'HIGH'],
      ['Бизнес-анализ', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'nsu-appl', university: 'nsu',
    name: 'Прикладная информатика',
    code: '09.03.03', direction: 'Прикладная информатика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 170, studentCount: 70, groupCount: 3,
    skills: [
      ['Аналитика данных', 'BASIC', 'HIGH'],
      ['SQL', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'nsu-infosec', university: 'nsu',
    name: 'Информационная безопасность',
    code: '10.03.01', direction: 'Информационная безопасность',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 160, studentCount: 66, groupCount: 2,
    skills: [
      ['Информационная безопасность', 'INTERMEDIATE', 'CRITICAL'],
      ['Сетевые технологии', 'BASIC', 'HIGH'],
    ] as const,
  },
  {
    key: 'rostov-master', university: 'rostov',
    name: 'Информатика и вычислительная техника',
    code: '09.04.01', direction: 'Информатика и вычислительная техника',
    level: 'MASTER' as const, durationMonths: 24,
    applicationCount: 90, studentCount: 36, groupCount: 2,
    skills: [
      ['Python', 'INTERMEDIATE', 'HIGH'],
      ['Аналитика данных', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'rostov-infosec', university: 'rostov',
    name: 'Информационная безопасность',
    code: '10.03.01', direction: 'Информационная безопасность',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 150, studentCount: 62, groupCount: 2,
    skills: [
      ['Информационная безопасность', 'INTERMEDIATE', 'CRITICAL'],
      ['Linux', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'rostov-ivt', university: 'rostov',
    name: 'Информатика и вычислительная техника',
    code: '09.03.01', direction: 'Информатика и вычислительная техника',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 200, studentCount: 82, groupCount: 3,
    skills: [
      ['Тестирование ПО', 'BASIC', 'HIGH'],
      ['Linux', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'kazan-infosec', university: 'kazan',
    name: 'Информационная безопасность',
    code: '10.03.01', direction: 'Информационная безопасность',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 170, studentCount: 70, groupCount: 3,
    skills: [
      ['Информационная безопасность', 'INTERMEDIATE', 'CRITICAL'],
      ['Сетевые технологии', 'BASIC', 'HIGH'],
    ] as const,
  },
  {
    key: 'kazan-isit', university: 'kazan',
    name: 'Информационные системы и технологии',
    code: '09.03.02', direction: 'Информационные системы и технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 190, studentCount: 78, groupCount: 3,
    skills: [
      ['JavaScript', 'BASIC', 'HIGH'],
      ['SQL', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'kazan-business', university: 'kazan',
    name: 'Бизнес-информатика и анализ данных',
    code: '38.03.05', direction: 'Бизнес-информатика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: 140, studentCount: 56, groupCount: 2,
    skills: [
      ['Аналитика данных', 'BASIC', 'HIGH'],
      ['Управление проектами', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  // УрФУ — тоже без показателей набора: заявочная кампания ещё не запускалась,
  // как и у существующих программ вуза (рейтинг вуза остаётся «Нет данных»).
  {
    key: 'urfu-isit', university: 'urfu',
    name: 'Информационные системы и технологии',
    code: '09.03.02', direction: 'Информационные системы и технологии',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['JavaScript', 'BASIC', 'MEDIUM'],
      ['SQL', 'BASIC', 'MEDIUM'],
    ] as const,
  },
  {
    key: 'urfu-appl', university: 'urfu',
    name: 'Прикладная информатика',
    code: '09.03.03', direction: 'Прикладная информатика',
    level: 'BACHELOR' as const, durationMonths: 48,
    applicationCount: null, studentCount: null, groupCount: null,
    skills: [
      ['Аналитика данных', 'BASIC', 'MEDIUM'],
      ['SQL', 'BASIC', 'LOW'],
    ] as const,
  },
]

/** Образовательные программы с навыками. Возвращает поиск id программы по ключу. */
async function seedPrograms(
  skillId: IdOf,
  universityId: IdOf,
  universityCreatedAt: Map<string, Date>,
): Promise<IdOf> {
  const programs = new Map<string, string>()
  for (const item of programSeed) {
    const hasMetrics =
      item.applicationCount !== null || item.studentCount !== null || item.groupCount !== null
    // У СПбГУТ есть представитель в кабинете вуза: показатели набора внёс и подтвердил
    // сам вуз — это данные вуза, а не оценка, и карточка программы не расходится
    // с кабинетом. У остальных вузов кабинета нет.
    const reportedByUniversity = item.university === 'spbgu'
    const metricsUpdatedAt = hasMetrics ? daysAgo(14) : null
    const createdAt = new Date(universityCreatedAt.get(item.university)!.getTime() + 2 * DAY)
    const created = await prisma.educationalProgram.create({
      data: {
        createdAt,
        updatedAt: metricsUpdatedAt ?? createdAt,
        universityId: universityId(item.university),
        name: item.name,
        code: item.code,
        direction: item.direction,
        level: item.level,
        durationMonths: item.durationMonths,
        status: item.status ?? 'ACTIVE',
        archivedAt: item.status === 'ARCHIVED' ? daysAgo(120) : null,
        applicationCount: item.applicationCount,
        studentCount: item.studentCount,
        groupCount: item.groupCount,
        metricsSource: hasMetrics ? (reportedByUniversity ? 'MANUAL' : 'MOCK') : null,
        metricsUpdatedAt,
        isMock: true,
        skills: {
          create: fillProgramSkills(
            item.key,
            item.skills,
            BASE_SKILLS.map((skill) => skill.name),
          ).map(([name, level, importance]) => ({
            skillId: skillId(name),
            level,
            importance,
            source: 'CURRICULUM' as const,
            confidence: 'MEDIUM' as const,
          })),
        },
      },
    })
    programs.set(item.key, created.id)
  }
  const programId = (key: string): string => {
    const id = programs.get(key)
    if (!id) throw new Error(`Программа не найдена: ${key}`)
    return id
  }
  return programId
}

/** Описание связки демо-набора: из него строятся запись, этапы и их хронология. */
interface CooperationSeed {
  university: string
  program: string
  productId: string | null
  responsibleId: string
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  goal: string
  /** Заметка связки: причина паузы или отмены. */
  notes?: string
  /** Отменённая связка: сколько дней назад закрыта. */
  closedDaysAgo?: number
  /**
   * Работа остановлена после закрытого этапа: следующий не начат. Пауза ставится
   * между этапами — иначе этап «в работе» на стоящей связке считался бы просроченным.
   */
  nextStageNotStarted?: boolean
  startedDaysAgo: number
  firstContactDaysAgo: number | null
  classesStartInDays: number | null
  /** До какого номера этапы считаются завершёнными. */
  completedUpTo: number
  blockedStage?: number
  blockingReason?: string
  /** Этапам с этими номерами ставится просроченный срок. */
  overdueStages?: number[]
  /**
   * Завершённые этапы, закрытые ПОСЛЕ срока.
   *
   * Без них показатель «этапы, закрытые в срок» всегда равен 100 %: завершение
   * в демо-наборе по построению ложится раньше срока. Стопроцентная дисциплина
   * обесценивает сам контроль сроков — на демонстрации нечего показать.
   */
  lateStages?: number[]
  cancelledStages?: number[]
}

/** Связки «вуз — программа — продукт» со всеми 14 этапами, историей и журналом. */
async function seedCooperations(
  products: SeedProducts,
  manager: SeedUser,
  manager2: SeedUser,
  universityId: IdOf,
  programId: IdOf,
): Promise<CreatedCooperation[]> {
  console.log('Связки и этапы...')

  const cooperationSeed: CooperationSeed[] = [
    {
      // Завершённая связка: сотрудничество доведено до конца.
      //
      // Нужна не для красоты. Во-первых, на демонстрации видно итог, а не только
      // процесс. Во-вторых, закрытая связка не должна требовать внимания:
      // её просроченные этапы не попадают ни в списки проблемных, ни на дашборд —
      // проверять это не на чем, если в наборе нет ни одной закрытой.
      university: 'kazan', program: 'kazan-networks', productId: products.dataLab.id,
      responsibleId: manager.id, status: 'COMPLETED',
      goal: 'Курс аналитики данных прочитан, сотрудничество завершено',
      startedDaysAgo: 400, firstContactDaysAgo: 400, classesStartInDays: null,
      completedUpTo: 13, lateStages: [4],
    },
    {
      // Самая «взрослая» связка: дошла до повышения квалификации преподавателей.
      // Этап 12 здесь закрыт — на нём видно, как групповая операция по выпуску
      // новой версии продукта переоткрывает переданные материалы.
      university: 'spbgu', program: 'spbgu-infosec', productId: products.security.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Внедрение системы мониторинга безопасности в учебный процесс',
      // Занятия идут два месяца: этапы 11 «Проведение занятий» и 12 закрыты,
      // значит, занятия уже начались.
      startedDaysAgo: 210, firstContactDaysAgo: 210, classesStartInDays: -60,
      completedUpTo: 12, lateStages: [6, 9],
    },
    {
      university: 'spbgu', program: 'spbgu-soft', productId: products.devops.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'Конвейер сборки в курсе программной инженерии',
      startedDaysAgo: 120, firstContactDaysAgo: 120, classesStartInDays: 75,
      completedUpTo: 5, overdueStages: [6], lateStages: [4],
    },
    {
      university: 'mtuci', program: 'mtuci-cloud', productId: products.cloud.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Облачная платформа для магистратуры',
      startedDaysAgo: 95, firstContactDaysAgo: 95, classesStartInDays: 100,
      completedUpTo: 6, blockedStage: 7, lateStages: [2],
      blockingReason: 'Вуз не подтвердил получение лицензии: ожидаем ответ юридической службы',
    },
    {
      // Ответственный — только менеджер или администратор (RESPONSIBLE_ROLES):
      // аналитик в этой роли числился бы за этапами, которые не может изменить.
      university: 'mtuci', program: 'mtuci-data', productId: products.dataLab.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'Аналитическая платформа в программе анализа данных',
      startedDaysAgo: 60, firstContactDaysAgo: 60, classesStartInDays: 140,
      completedUpTo: 4, cancelledStages: [5],
    },
    {
      university: 'kazan', program: 'kazan-devops', productId: products.devops.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'DevOps-практики в бакалавриате',
      startedDaysAgo: 45, firstContactDaysAgo: 45, classesStartInDays: null,
      completedUpTo: 2, overdueStages: [3, 4],
    },
    {
      // Дошли до обмена документами, а IT-продукт так и не выбран:
      // этот случай должно поймать правило рекомендаций cooperation.no-product.
      university: 'nsu', program: 'nsu-ai', productId: null,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Документы оформляются, IT-продукт ещё не выбран',
      startedDaysAgo: 70, firstContactDaysAgo: 70, classesStartInDays: 120,
      completedUpTo: 4,
    },
    {
      university: 'urfu', program: 'urfu-security', productId: products.security.id,
      responsibleId: manager2.id, status: 'DRAFT',
      goal: 'Первичные переговоры',
      startedDaysAgo: 5, firstContactDaysAgo: null, classesStartInDays: null,
      completedUpTo: 0,
    },
    {
      // На паузе: вуз пересматривает учебный план, переговоры вернутся в декабре.
      // Вуз тоже «приостановлен» — связка объясняет, почему.
      university: 'rostov', program: 'rostov-it', productId: products.cloud.id,
      responsibleId: manager.id, status: 'PAUSED',
      goal: 'Облачная платформа в курсе ИТ-управления',
      notes: 'Пауза: вуз пересматривает учебный план на следующий год. Вернуться к переговорам в декабре.',
      // Договор подписан, этап 4 закрыт с опозданием: доля этапов «в срок» по набору
      // остаётся той же, что в сценарии показа (demo-check).
      startedDaysAgo: 200, firstContactDaysAgo: 200, classesStartInDays: null,
      completedUpTo: 6, nextStageNotStarted: true, lateStages: [4],
    },
    {
      // Отменена: вуз выбрал собственный стенд вместо нашего продукта. Закрытая связка
      // в проблемы и рекомендации не попадает, но остаётся в истории вуза.
      university: 'nsu', program: 'nsu-soft', productId: products.devops.id,
      responsibleId: manager2.id, status: 'CANCELLED',
      goal: 'Конвейер сборки в программе разработки информационных систем',
      notes: 'Отменена: вуз решил использовать собственный стенд. Договор не подписывали.',
      startedDaysAgo: 150, firstContactDaysAgo: 150, classesStartInDays: null,
      completedUpTo: 3, cancelledStages: [4], closedDaysAgo: 40,
    },
    // Решение 141: 4–7 связок на вуз (было 1–2) — программы общих направлений,
    // во всех статусах и на разных этапах.
    {
      university: 'mtuci', program: 'mtuci-isit', productId: products.devops.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Конвейер сборки в информационных системах',
      startedDaysAgo: 180, firstContactDaysAgo: 180, classesStartInDays: -20,
      completedUpTo: 8, lateStages: [3],
    },
    {
      university: 'mtuci', program: 'mtuci-networks', productId: products.legacyNet.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'Сетевой стенд в инфокоммуникационных технологиях',
      startedDaysAgo: 50, firstContactDaysAgo: 50, classesStartInDays: 160,
      completedUpTo: 3, overdueStages: [4],
    },
    {
      university: 'mtuci', program: 'mtuci-appl', productId: null,
      responsibleId: manager.id, status: 'DRAFT',
      goal: 'Первичные переговоры по прикладной информатике',
      startedDaysAgo: 8, firstContactDaysAgo: null, classesStartInDays: null,
      completedUpTo: 0,
    },
    {
      university: 'nsu', program: 'nsu-appl', productId: products.dataLab.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'Аналитическая платформа в прикладной информатике',
      startedDaysAgo: 140, firstContactDaysAgo: 140, classesStartInDays: 90,
      completedUpTo: 6, blockedStage: 7, lateStages: [3],
      blockingReason: 'Вуз не назначил ответственного за приёмку материалов',
    },
    {
      university: 'nsu', program: 'nsu-infosec', productId: products.security.id,
      responsibleId: manager.id, status: 'PAUSED',
      goal: 'Мониторинг безопасности в бакалавриате ИБ',
      notes: 'Пауза: вуз пересматривает учебный план на следующий год.',
      startedDaysAgo: 160, firstContactDaysAgo: 160, classesStartInDays: null,
      completedUpTo: 3, nextStageNotStarted: true,
    },
    {
      // Программа доп. образования архивная, связка так и не пошла дальше знакомства.
      university: 'nsu', program: 'nsu-embedded', productId: null,
      responsibleId: manager2.id, status: 'CANCELLED',
      goal: 'Встраиваемые системы в магистратуре',
      notes: 'Отменена: программу закрыли до начала переговоров по IT-продукту.',
      startedDaysAgo: 100, firstContactDaysAgo: 100, classesStartInDays: null,
      completedUpTo: 1, cancelledStages: [2], closedDaysAgo: 60,
    },
    {
      university: 'rostov', program: 'rostov-master', productId: products.dataLab.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Аналитическая платформа в магистратуре ИВТ',
      startedDaysAgo: 40, firstContactDaysAgo: 40, classesStartInDays: 200,
      completedUpTo: 2,
    },
    {
      university: 'rostov', program: 'rostov-infosec', productId: products.security.id,
      responsibleId: manager2.id, status: 'ACTIVE',
      goal: 'Мониторинг безопасности в бакалавриате ИБ',
      startedDaysAgo: 220, firstContactDaysAgo: 220, classesStartInDays: -20,
      completedUpTo: 9, overdueStages: [10],
    },
    {
      university: 'rostov', program: 'rostov-ivt', productId: null,
      responsibleId: manager.id, status: 'DRAFT',
      goal: 'Первичные переговоры по информатике и вычислительной технике',
      startedDaysAgo: 6, firstContactDaysAgo: null, classesStartInDays: null,
      completedUpTo: 0,
    },
    {
      // Вторая связка вуза на паузе — по той же причине, что и rostov-it.
      university: 'rostov', program: 'rostov-networks', productId: products.legacyNet.id,
      responsibleId: manager2.id, status: 'PAUSED',
      goal: 'Сетевой стенд в инфокоммуникационных технологиях',
      notes: 'Пауза: та же причина, что и у остальных связок вуза — пересмотр учебного плана.',
      startedDaysAgo: 130, firstContactDaysAgo: 130, classesStartInDays: null,
      completedUpTo: 4, nextStageNotStarted: true,
    },
    {
      university: 'kazan', program: 'kazan-infosec', productId: products.security.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Мониторинг безопасности в бакалавриате ИБ',
      startedDaysAgo: 170, firstContactDaysAgo: 170, classesStartInDays: 60,
      completedUpTo: 5, blockedStage: 6,
      blockingReason: 'Договор на подписании у проректора по безопасности',
    },
    {
      university: 'kazan', program: 'kazan-isit', productId: products.cloud.id,
      responsibleId: manager2.id, status: 'COMPLETED',
      goal: 'Облачная платформа в информационных системах: курс прочитан',
      startedDaysAgo: 380, firstContactDaysAgo: 380, classesStartInDays: null,
      completedUpTo: 13, lateStages: [7],
    },
    {
      university: 'kazan', program: 'kazan-business', productId: products.dataLab.id,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Аналитическая платформа в бизнес-информатике',
      startedDaysAgo: 60, firstContactDaysAgo: 60, classesStartInDays: 210,
      completedUpTo: 2, overdueStages: [3],
    },
    {
      university: 'urfu', program: 'urfu-isit', productId: null,
      responsibleId: manager2.id, status: 'DRAFT',
      goal: 'Первичные переговоры по информационным системам',
      startedDaysAgo: 10, firstContactDaysAgo: null, classesStartInDays: null,
      completedUpTo: 0,
    },
    {
      university: 'urfu', program: 'urfu-appl', productId: null,
      responsibleId: manager.id, status: 'ACTIVE',
      goal: 'Первый контакт по прикладной информатике',
      startedDaysAgo: 20, firstContactDaysAgo: 20, classesStartInDays: null,
      completedUpTo: 1,
    },
    {
      // Программа игр так и осталась черновиком, связка отменена вместе с ней.
      university: 'urfu', program: 'urfu-gamedev', productId: null,
      responsibleId: manager2.id, status: 'CANCELLED',
      goal: 'Технологии разработки компьютерных игр',
      notes: 'Отменена: программу не утвердили, IT-продукт не выбирали.',
      startedDaysAgo: 15, firstContactDaysAgo: 15, classesStartInDays: null,
      completedUpTo: 0, cancelledStages: [1], closedDaysAgo: 5,
    },
  ]

  const createdCooperations: CreatedCooperation[] = []
  for (const item of cooperationSeed) {
    createdCooperations.push(await seedCooperation(item, universityId, programId))
  }
  return createdCooperations
}

/**
 * Одна связка: запись, этапы со сроками и хронологией, чек-листы, история этапов
 * и те же события в журнале действий, что пишет работающая система.
 *
 * Застой не подделывается: даты изменения не сдвигаются, правило застоя смотрит
 * на движение по этапам (решение 56) и само находит связку, где работа стоит.
 */
async function seedCooperation(
  item: CooperationSeed,
  universityId: IdOf,
  programId: IdOf,
): Promise<CreatedCooperation> {
  const startedAt = daysAgo(item.startedDaysAgo)

  const cooperation = await prisma.cooperation.create({
    data: {
      universityId: universityId(item.university),
      programId: programId(item.program),
      productId: item.productId,
      responsibleId: item.responsibleId,
      status: item.status,
      goal: item.goal,
      notes: item.notes ?? null,
      startedAt,
      firstContactAt:
        item.firstContactDaysAgo === null ? null : daysAgo(item.firstContactDaysAgo),
      classesStartAt:
        item.classesStartInDays === null ? null : daysAhead(item.classesStartInDays),
      targetDate: item.classesStartInDays === null ? null : daysAhead(item.classesStartInDays),
      isMock: true,
      // Время записи — по сюжету, а не момент заливки: связка заведена, когда
      // началась работа, и с тех пор не правилась (решение 56).
      createdAt: startedAt,
      updatedAt: startedAt,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: item.responsibleId,
      action: 'cooperation.create',
      objectType: 'Cooperation',
      objectId: cooperation.id,
      payload: { status: item.status },
      createdAt: startedAt,
    },
  })

  type SeedStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED'
  const seedStatus = (number: number): SeedStageStatus => {
    if (item.cancelledStages?.includes(number)) return 'CANCELLED'
    if (number <= item.completedUpTo) return 'COMPLETED'
    if (item.blockedStage === number) return 'BLOCKED'
    if (number === item.completedUpTo + 1 && !item.nextStageNotStarted) return 'IN_PROGRESS'
    return 'NOT_STARTED'
  }
  // Контрольный этап — тем же правилом, что в системе (computeControlStatus), а не своей копией.
  const controlStatus = computeControlStatus(
    WORKFLOW_STAGES.filter((definition) => definition.number !== 14).map((definition) =>
      seedStatus(definition.number),
    ),
  )

  // Сроки этапов. Нормативные — от начала связки, но этапы 11–14 (занятия
  // и то, что идёт после них) привязаны к началу занятий: срок «Проведения занятий»
  // не может быть раньше их начала.
  const classesStartAt =
    item.classesStartInDays === null ? null : daysAhead(item.classesStartInDays)
  const deadlineOf = new Map<number, Date>()
  for (const definition of WORKFLOW_STAGES) {
    const number = definition.number
    let deadline = item.overdueStages?.includes(number)
      ? daysAgo(Math.max(3, item.startedDaysAgo - definition.normativeDays))
      : new Date(startedAt.getTime() + definition.normativeDays * DAY)
    const afterClasses = DAYS_AFTER_CLASSES_START[number]
    if (classesStartAt && afterClasses !== undefined) {
      const fromClasses = new Date(classesStartAt.getTime() + afterClasses * DAY)
      if (fromClasses > deadline) deadline = fromClasses
    }
    deadlineOf.set(number, deadline)
  }

  // Хронология: этап начинается, когда закрыт предыдущий, и закрывается
  // незадолго до своего срока, а опоздавший (lateStages) — через несколько дней после.
  // Так завершения распределены по всей жизни связки, и тренд главной не пуст.
  const timeline = new Map<number, { startedAt: Date | null; completedAt: Date | null }>()
  let previousDoneAt = startedAt
  for (const definition of WORKFLOW_STAGES) {
    const number = definition.number
    if (number === 14) continue
    const status = seedStatus(number)
    if (status === 'NOT_STARTED') {
      timeline.set(number, { startedAt: null, completedAt: null })
      continue
    }
    const stageStartedAt = previousDoneAt
    if (status !== 'COMPLETED') {
      timeline.set(number, { startedAt: stageStartedAt, completedAt: null })
      continue
    }
    const deadline = deadlineOf.get(number)!
    let completedAt = item.lateStages?.includes(number)
      ? new Date(deadline.getTime() + (3 + (number % 5)) * DAY)
      : new Date(deadline.getTime() - (1 + (number % 3)) * DAY)
    const earliest = new Date(stageStartedAt.getTime() + DAY / 2)
    if (completedAt < earliest) completedAt = earliest
    const latest = daysAgo(1)
    if (completedAt > latest) completedAt = latest
    timeline.set(number, { startedAt: stageStartedAt, completedAt })
    previousDoneAt = completedAt
  }
  // Контрольный этап открывается с началом работы и закрывается вместе с последним.
  timeline.set(14, {
    startedAt: controlStatus === 'NOT_STARTED' ? null : startedAt,
    completedAt: controlStatus === 'COMPLETED' ? previousDoneAt : null,
  })

  let lastCompletedAt: Date | null = null

  for (const definition of WORKFLOW_STAGES) {
    const number = definition.number
    const isControl = number === 14
    const status = seedStatus(number)
    const deadline = deadlineOf.get(number)!
    const dates = timeline.get(number)!

    const finalStatus = isControl ? controlStatus : status

    const stage = await prisma.workflowStage.create({
      data: {
        cooperationId: cooperation.id,
        stageNumber: number,
        title: definition.title,
        phase: definition.phase,
        status: finalStatus,
        responsibleId: item.responsibleId,
        // Открытый этап со сроком в будущем не должен стать просроченным за время
        // экспертизы: срок — за окном стабильности (решение 131).
        deadline: finalStatus === 'COMPLETED' ? deadline : stabilize(deadline),
        startedAt: dates.startedAt,
        completedAt: dates.completedAt,
        completedById: finalStatus === 'COMPLETED' && !isControl ? item.responsibleId : null,
        result:
          finalStatus === 'COMPLETED' && !isControl
            ? `Этап «${definition.title}» выполнен (демонстрационные данные)`
            : null,
        comment:
          finalStatus === 'CANCELLED' ? 'Не требуется для этой связки' : null,
        blockingReason: finalStatus === 'BLOCKED' ? (item.blockingReason ?? null) : null,
        ...(definition.tasks.length > 0
          ? {
              tasks: {
                createMany: {
                  data: definition.tasks.map((task, index) => ({
                    title: task.title,
                    isRequired: task.isRequired,
                    isUniversityItem: task.universityItem === true,
                    sortOrder: index,
                    isDone: finalStatus === 'COMPLETED',
                    doneAt: dates.completedAt,
                    doneById: finalStatus === 'COMPLETED' ? item.responsibleId : null,
                    // Пункт вуза (решение 103). У вуза без представителя его отметил
                    // сотрудник — значит, с пометкой, чем подтверждено. У СПбГУТ
                    // представитель есть: отметку ниже переписываем на него.
                    confirmationNote:
                      finalStatus === 'COMPLETED' &&
                      task.universityItem === true &&
                      item.university !== UNIVERSITY_WITH_REP
                        ? 'Подтверждено письмом вуза (демонстрационные данные)'
                        : null,
                  })),
                },
              },
            }
          : {}),
      },
    })

    if (stage.completedAt && (!lastCompletedAt || stage.completedAt > lastCompletedAt)) {
      lastCompletedAt = stage.completedAt
    }

    if (finalStatus !== 'NOT_STARTED') {
      // История — переходами, как её пишет система: вход в этап и выход из него.
      // По ним аналитика этапов (решение 120) считает длительности; одна запись
      // «Не начат → Завершён» длительности не даёт.
      const entered = dates.startedAt ?? startedAt
      const transitions: Array<{ from: SeedStageStatus; to: SeedStageStatus; at: Date }> =
        finalStatus === 'CANCELLED'
          ? [{ from: 'NOT_STARTED', to: 'CANCELLED', at: dates.completedAt ?? entered }]
          : [
              { from: 'NOT_STARTED', to: 'IN_PROGRESS', at: entered },
              ...(finalStatus === 'COMPLETED'
                ? [{ from: 'IN_PROGRESS' as const, to: 'COMPLETED' as const, at: dates.completedAt ?? entered }]
                : finalStatus === 'BLOCKED'
                  ? [{ from: 'IN_PROGRESS' as const, to: 'BLOCKED' as const, at: new Date(entered.getTime() + 1000) }]
                  : []),
            ]

      await prisma.stageHistory.createMany({
        data: transitions.map((transition) => ({
          stageId: stage.id,
          fromStatus: transition.from,
          toStatus: transition.to,
          comment: 'Демонстрационные данные',
          changedById: item.responsibleId,
          changedAt: transition.at,
        })),
      })

      // То же событие пишется и в журнал действий — ровно как делает работающая
      // система. Иначе демо-набор внутренне противоречив: история этапов есть,
      // а журнал пуст, и администратор видит пустой раздел при десятках
      // завершённых этапов.
      await prisma.auditLog.createMany({
        data: transitions.map((transition) => ({
          userId: item.responsibleId,
          action: 'stage.status.change',
          objectType: 'WorkflowStage',
          objectId: stage.id,
          payload: { from: transition.from, to: transition.to, stageNumber: number },
          createdAt: transition.at,
        })),
      })
    }
  }

  // Закрытая связка закрыта вместе с последним этапом. Приложение ставит дату
  // закрытия при смене статуса; без неё карточка не показывает «Закрыта»,
  // а db:verify считает запись противоречивой.
  if (item.status === 'COMPLETED' && lastCompletedAt) {
    await prisma.cooperation.update({
      where: { id: cooperation.id },
      data: { closedAt: lastCompletedAt, updatedAt: lastCompletedAt },
    })
  }
  // Отменённая закрыта в день отмены — так же, как её закрыло бы приложение.
  if (item.status === 'CANCELLED' && item.closedDaysAgo !== undefined) {
    const closedAt = daysAgo(item.closedDaysAgo)
    await prisma.cooperation.update({
      where: { id: cooperation.id },
      data: { closedAt, updatedAt: closedAt },
    })
    await prisma.auditLog.create({
      data: {
        userId: item.responsibleId,
        action: 'cooperation.update',
        objectType: 'Cooperation',
        objectId: cooperation.id,
        payload: { status: 'CANCELLED' },
        createdAt: closedAt,
      },
    })
  }

  return {
    key: `${item.university}-${item.program}`,
    id: cooperation.id,
    universityKey: item.university,
  }
}

/**
 * Представитель вуза в кабинете. Роли UNIVERSITY_REP обязательно нужен свой вуз
 * (решение 9), поэтому создаётся после вузов и связок.
 */
async function seedUniversityRep(demoPasswordHash: string, universityId: IdOf) {
  const universityRep = await prisma.user.create({
    data: {
      email: 'rep@spbgu.example.invalid',
      passwordHash: demoPasswordHash,
      fullName: 'Ветрова Ирина Павловна',
      position: 'Заместитель декана',
      role: 'UNIVERSITY_REP',
      universityId: universityId(UNIVERSITY_WITH_REP),
    },
  })

  // Пункт «Вуз подтвердил получение материалов» у вуза с представителем отмечает
  // представитель в кабинете (решение 103), а не ответственный связки. Представитель
  // появляется только здесь, поэтому отметки переписываются после этапов; дата
  // та же — день закрытия этапа 7. В журнал — то же действие, что пишет кабинет.
  const repConfirmed = await prisma.task.findMany({
    where: {
      isUniversityItem: true,
      isDone: true,
      stage: { cooperation: { universityId: universityId(UNIVERSITY_WITH_REP) } },
    },
    select: { id: true, doneAt: true },
  })
  for (const task of repConfirmed) {
    await prisma.task.update({
      where: { id: task.id },
      data: { doneById: universityRep.id, confirmationNote: null },
    })
    await prisma.auditLog.create({
      data: {
        userId: universityRep.id,
        action: 'portal.material.confirm',
        objectType: 'Task',
        objectId: task.id,
        payload: { universityId: universityId(UNIVERSITY_WITH_REP), withComment: false },
        ...(task.doneAt ? { createdAt: task.doneAt } : {}),
      },
    })
  }
  return universityRep
}

/**
 * Связка по ключу «вуз-программа», а не по номеру в списке: вставка связки в начало
 * списка не должна переносить документы и встречи к соседям. Неизвестный ключ
 * роняет заливку, а не пропускается молча.
 */
function cooperationByKey(cooperations: CreatedCooperation[], key: string): CreatedCooperation {
  const found = cooperations.find((item) => item.key === key)
  if (!found) throw new Error(`В демонстрационном наборе нет связки ${key}`)
  return found
}

/** Документы связок с историей статусов. */
async function seedDocuments(
  cooperations: CreatedCooperation[],
  manager: SeedUser,
  universityId: IdOf,
): Promise<void> {
  console.log('Документы и встречи...')

  const docPlan: Array<{
    coopKey: string
    type: 'NDA' | 'AGREEMENT' | 'ANNEX' | 'ACT' | 'LICENSE' | 'CURRICULUM' | 'METHODOLOGY'
    title: string
    status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED'
    version: string
    daysAgoIssued: number
  }> = [
    // Первая редакция договора, замененная второй: в архиве, в проверках подписания
    // не участвует (documents.rules — архивные не считаются).
    { coopKey: 'spbgu-spbgu-infosec', type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'ARCHIVED', version: '1', daysAgoIssued: 185 },
    // Связка на этапе 13: всё давно подписано.
    { coopKey: 'spbgu-spbgu-infosec', type: 'NDA', title: 'Соглашение о неразглашении', status: 'SIGNED', version: '1', daysAgoIssued: 190 },
    { coopKey: 'spbgu-spbgu-infosec', type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'SIGNED', version: '2', daysAgoIssued: 170 },
    // Лицензия подписана до закрытия этапа 7 «Передача материалов и лицензии».
    { coopKey: 'spbgu-spbgu-infosec', type: 'LICENSE', title: 'Лицензия на IT-продукт', status: 'SIGNED', version: '1', daysAgoIssued: 145 },
    // Подписание идёт (этап 6), договор на согласовании: не подписан, пока
    // обе подписи не отмечены в чек-листе — ровно то, что показывается жюри.
    { coopKey: 'spbgu-spbgu-soft', type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'REVIEW', version: '1', daysAgoIssued: 20 },
    // Договор подписан, лицензия согласована, этап 7 заблокирован: вуз
    // не подтвердил получение лицензии.
    { coopKey: 'mtuci-mtuci-cloud', type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'SIGNED', version: '1', daysAgoIssued: 60 },
    { coopKey: 'mtuci-mtuci-cloud', type: 'LICENSE', title: 'Лицензия на облачную платформу', status: 'APPROVED', version: '1', daysAgoIssued: 15 },
    { coopKey: 'mtuci-mtuci-data', type: 'CURRICULUM', title: 'Обновлённый учебный план', status: 'DRAFT', version: '1', daysAgoIssued: 10 },
    { coopKey: 'kazan-kazan-devops', type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'REJECTED', version: '1', daysAgoIssued: 25 },
  ]

  for (const plan of docPlan) {
    const coop = cooperationByKey(cooperations, plan.coopKey)

    // История статусов: путь от черновика до текущего состояния, шаг — два дня.
    // Архивная первая редакция: была на согласовании и заменена второй.
    const path: Array<'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED'> =
      plan.status === 'ARCHIVED'
        ? ['REVIEW', 'ARCHIVED']
        : plan.status === 'SIGNED'
        ? ['REVIEW', 'APPROVED', 'SIGNED']
        : plan.status === 'APPROVED'
          ? ['REVIEW', 'APPROVED']
          : plan.status === 'REJECTED'
            ? ['REVIEW', 'REJECTED']
            : plan.status === 'REVIEW'
              ? ['REVIEW']
              : []
    const lastChangedAt = daysAgo(Math.max(1, plan.daysAgoIssued - 2 * path.length))

    const document = await prisma.document.create({
      data: {
        cooperationId: coop.id,
        universityId: universityId(coop.universityKey),
        type: plan.type,
        title: plan.title,
        version: plan.version,
        status: plan.status,
        fileReference: `https://example.invalid/docs/${plan.type.toLowerCase()}-${plan.version}.pdf`,
        authorId: manager.id,
        responsibleId: manager.id,
        issuedAt: daysAgo(plan.daysAgoIssued),
        // День подписания — тот же, что у перехода «Подписан» в истории ниже.
        signedAt: plan.status === 'SIGNED' ? lastChangedAt : null,
        // Даты записи — по сюжету: заведён в день выпуска, обновлён последней сменой статуса.
        createdAt: daysAgo(plan.daysAgoIssued),
        updatedAt: lastChangedAt,
      },
    })

    let previous: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' | 'ARCHIVED' = 'DRAFT'
    let offset = plan.daysAgoIssued
    for (const step of path) {
      offset -= 2
      await prisma.documentHistory.create({
        data: {
          documentId: document.id,
          fromStatus: previous,
          toStatus: step,
          comment:
            step === 'REJECTED'
              ? 'Требуется приложение с перечнем материалов'
              : step === 'ARCHIVED'
                ? 'Заменена второй редакцией'
                : 'Демонстрационные данные',
          changedById: manager.id,
          changedAt: daysAgo(Math.max(1, offset)),
        },
      })
      previous = step
    }
  }
}

/** Встречи с вузами: участник от ИТ-Школы и основной контакт вуза. */
async function seedMeetings(
  cooperations: CreatedCooperation[],
  manager: SeedUser,
  universityId: IdOf,
): Promise<void> {
  const meetingPlan: Array<{
    coopKey: string
    daysAgoDate: number
    topic: string
    format: 'ONLINE' | 'OFFLINE' | 'CALL' | 'CORRESPONDENCE'
    result: string
    nextAction: string | null
    nextActionInDays: number | null
  }> = [
    {
      coopKey: 'spbgu-spbgu-infosec', daysAgoDate: 195, topic: 'Первичное знакомство с кафедрой', format: 'ONLINE',
      result: 'Кафедра подтвердила интерес, назначен ответственный',
      nextAction: 'Направить пакет документов', nextActionInDays: -188,
    },
    {
      // Накануне закрытия этапа 7: на встрече материалы и переданы.
      coopKey: 'spbgu-spbgu-infosec', daysAgoDate: 136, topic: 'Передача учебных материалов', format: 'OFFLINE',
      result: 'Материалы переданы, лицензия активирована',
      nextAction: null, nextActionInDays: null,
    },
    {
      coopKey: 'mtuci-mtuci-cloud', daysAgoDate: 40, topic: 'Согласование условий лицензии', format: 'CALL',
      result: 'Юридическая служба вуза запросила дополнительные сведения',
      nextAction: 'Подготовить ответ юридической службе', nextActionInDays: 7,
    },
    {
      coopKey: 'kazan-kazan-devops', daysAgoDate: 30, topic: 'Обсуждение DevOps-практик в программе', format: 'ONLINE',
      result: 'Вуз просит расширить блок по контейнеризации',
      nextAction: 'Согласовать обновлённую программу', nextActionInDays: 14,
    },
    {
      // Переписка — тоже взаимодействие: по ней вуз и сообщил об отказе.
      coopKey: 'nsu-nsu-soft', daysAgoDate: 42, topic: 'Письмо вуза о решении по стенду', format: 'CORRESPONDENCE',
      result: 'Вуз решил использовать собственный стенд, связка отменена',
      nextAction: null, nextActionInDays: null,
    },
  ]

  for (const plan of meetingPlan) {
    const coop = cooperationByKey(cooperations, plan.coopKey)

    const contact = await prisma.contact.findFirst({
      where: { universityId: universityId(coop.universityKey) },
      select: { id: true },
    })

    await prisma.meeting.create({
      data: {
        cooperationId: coop.id,
        universityId: universityId(coop.universityKey),
        date: daysAgo(plan.daysAgoDate),
        // Запись о встрече заведена в день встречи, а не в момент заливки.
        createdAt: daysAgo(plan.daysAgoDate),
        updatedAt: daysAgo(plan.daysAgoDate),
        topic: plan.topic,
        format: plan.format,
        result: plan.result,
        nextAction: plan.nextAction,
        nextActionDueAt:
          plan.nextActionInDays === null ? null : stabilize(daysAhead(plan.nextActionInDays)),
        responsibleId: manager.id,
        participants: {
          create: [
            { userId: manager.id },
            ...(contact ? [{ contactId: contact.id }] : []),
          ],
        },
      },
    })
  }
}

/**
 * Заявки на обучение. applicationCount программы считается по заявкам (решение 9), поэтому демо-данные
 * обязаны быть согласованы: для каждой программы с заявками создаётся запись
 * ровно на то количество, которое проставлено в показателе. Иначе кабинет вуза
 * пересчитает показатель и цифра на демонстрации изменится на глазах у зрителей.
 */
async function seedApplications(universityId: IdOf, programId: IdOf): Promise<void> {
  console.log('Заявки на обучение...')
  for (const item of programSeed) {
    if (item.applicationCount === null) continue

    await prisma.application.create({
      data: {
        programId: programId(item.key),
        universityId: universityId(item.university),
        source: 'MOCK',
        status: 'CONFIRMED',
        quantity: item.applicationCount,
        comment: 'Демонстрационный пакет заявок',
        submittedAt: daysAgo(40),
      },
    })
  }

  // Сверяем показатель с суммой заявок: расхождение означало бы ошибку в наборе.
  for (const item of programSeed) {
    const aggregate = await prisma.application.aggregate({
      where: { programId: programId(item.key), status: { in: ['NEW', 'CONFIRMED', 'ENROLLED'] } },
      _sum: { quantity: true },
    })
    const total = aggregate._sum.quantity
    const expected = item.applicationCount
    if ((total ?? null) !== expected) {
      throw new Error(
        `Несогласованные демо-данные по программе ${item.key}: ` +
          `показатель ${expected}, сумма заявок ${total ?? null}`,
      )
    }
  }
}

/**
 * Намеренные «почти дубли» для экрана «Качество данных» (решение 134): так справочник
 * выглядит после ручного ввода и загрузок из разных источников. Два вуза — дубли
 * существующих (УрФУ с полным названием «имени…» и НГТУ с сокращениями «гос.», «ун-т»),
 * три навыка — синонимы (JS, Postgres, K8s). Без программ и связок: сценарий показа,
 * рейтинги и покрытие навыков они не меняют. Слить или отметить «не дубль» — на экране.
 *
 * Только с `SEED_DQ_CASES=1` (решение 139): экрана слияния во фронте ещё нет
 * (раздел E ревизии от 26.09.2026), и по умолчанию эти записи на демонстрационном
 * стенде — просто видимый эксперту мусор в реестрах вузов и навыков без способа
 * его убрать. Нужны при работе с самим экраном качества данных и для `npm run dq:report`:
 *   SEED_DQ_CASES=1 npm run db:seed
 */
async function seedDataQualityCases(universityId: IdOf): Promise<void> {
  console.log('Почти дубли для проверки качества данных...')
  const urfu = await prisma.university.findUniqueOrThrow({ where: { id: universityId('urfu') } })
  await prisma.university.create({
    data: {
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      name: 'Уральский федеральный университет имени первого Президента России Б.Н. Ельцина',
      city: urfu.city,
      region: urfu.region,
      website: 'https://example.invalid/urfu-dup',
      status: 'NEW',
      description: 'Демонстрационная запись: дубль, заведённый с полным названием.',
      isMock: true,
      contacts: {
        create: [{ fullName: 'Соколов Павел Андреевич', position: 'Специалист отдела партнёрств', isPrimary: true }],
      },
    },
  })
  const nsu = await prisma.university.findUniqueOrThrow({ where: { id: universityId('nsu') } })
  await prisma.university.create({
    data: {
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      name: 'Новосибирский гос. технический ун-т',
      city: nsu.city,
      region: nsu.region,
      status: 'NEW',
      description: 'Демонстрационная запись: дубль из загрузки с сокращениями.',
      isMock: true,
    },
  })
  await prisma.skill.createMany({
    data: [
      { name: 'JS', category: 'Языки программирования', description: 'Дубль «JavaScript» из загрузки' },
      { name: 'Postgres', category: 'Базы данных', description: 'Дубль «PostgreSQL» из загрузки' },
      { name: 'K8s', category: 'DevOps', description: 'Дубль «Kubernetes» из загрузки' },
    ],
  })
}

/**
 * Рекомендации: настоящий движок правил по посеянным данным, а не сочинённые записи.
 *
 * Без этого шага свежая демонстрация открывается с пустым блоком «приоритетные
 * действия» на дашборде: рекомендации появляются только после явной генерации.
 */
async function seedRecommendations(cooperations: CreatedCooperation[], manager: SeedUser): Promise<void> {
  console.log('Рекомендации...')
  const generation = await generateRecommendations({
    id: manager.id,
    email: manager.email,
    fullName: manager.fullName,
    role: manager.role,
    universityId: manager.universityId,
  })
  console.log(`  создано: ${generation.created}`)

  // Рекомендации во всех статусах, а не только «новые». Движок выдаёт только новые;
  // остальное — то, что сделали бы люди: одну взяли в работу, одну выполнили
  // и одну отклонили — обе последние на закрытых связках, где правило их больше
  // не выдаст, поэтому пересборка их не трогает.
  const noProduct = await prisma.recommendation.findFirst({ where: { ruleKey: 'cooperation.no-product' } })
  if (noProduct) {
    const takenAt = daysAgo(2)
    await prisma.recommendation.update({
      where: { id: noProduct.id },
      data: { status: 'IN_PROGRESS', updatedAt: takenAt },
    })
    await prisma.auditLog.create({
      data: {
        userId: manager.id, action: 'recommendation.status.change', objectType: 'Recommendation',
        objectId: noProduct.id, payload: { from: 'NEW', to: 'IN_PROGRESS', ruleKey: noProduct.ruleKey },
        createdAt: takenAt,
      },
    })
  }
  // Связка на паузе: правило застоя её видит, менеджер отклонил — пауза по просьбе вуза.
  const pausedCoop = cooperations.find((item) => item.key === 'rostov-rostov-it')
  const pausedStalled = pausedCoop
    ? await prisma.recommendation.findFirst({ where: { ruleKey: 'cooperation.stalled', objectId: pausedCoop.id } })
    : null
  if (pausedStalled) {
    const dismissedAt = daysAgo(3)
    await prisma.recommendation.update({
      where: { id: pausedStalled.id },
      data: {
        status: 'DISMISSED',
        resolutionComment: 'Пауза по просьбе вуза: пересматривают учебный план. Вернёмся в декабре.',
        resolvedById: manager.id,
        resolvedAt: dismissedAt,
        updatedAt: dismissedAt,
      },
    })
    await prisma.auditLog.create({
      data: {
        userId: manager.id, action: 'recommendation.status.change', objectType: 'Recommendation',
        objectId: pausedStalled.id, payload: { from: 'NEW', to: 'DISMISSED', ruleKey: pausedStalled.ruleKey },
        createdAt: dismissedAt,
      },
    })
  }
  const completedCoop = cooperations.find((item) => item.key === 'kazan-kazan-networks')
  const cancelledCoop = cooperations.find((item) => item.key === 'nsu-nsu-soft')
  const stage4 = WORKFLOW_STAGES.find((definition) => definition.number === 4)!
  const resolvedPlan = [
    completedCoop && {
      // Приоритет «высокий», как у правила при короткой просрочке: закрытая
      // рекомендация не должна стоять в ленте среди открытых критичных.
      cooperationId: completedCoop.id, ruleKey: 'stage.overdue', status: 'DONE' as const,
      type: 'ACTION' as const, priority: 'HIGH' as const,
      title: `Просрочен этап 4: ${stage4.title}`,
      description: 'Свяжитесь с ответственным и закройте этап либо перенесите срок с комментарием.',
      justification: 'Нормативный срок этапа прошёл 6 дн. назад, этап был в статусе «В работе».',
      comment: 'Встреча проведена с опозданием, этап закрыт. Срок следующих согласован с вузом.',
      relatedData: { status: 'IN_PROGRESS', deadline: daysAgo(346).toISOString(), daysOverdue: 6, stageNumber: 4 },
      createdDaysAgo: 340, resolvedDaysAgo: 330,
    },
    cancelledCoop && {
      cooperationId: cancelledCoop.id, ruleKey: 'cooperation.stalled', status: 'DISMISSED' as const,
      type: 'ACTION' as const, priority: 'MEDIUM' as const,
      title: 'Связка без движения 21 дн.',
      description: 'Уточните у вуза, в силе ли планы, и назначьте следующий шаг.',
      justification: 'По этапам связки не было движения 21 день.',
      comment: 'Не актуально: вуз письмом отказался от продукта, связка отменена.',
      relatedData: { idleDays: 21, stageNumber: 4, stageStatus: 'NOT_STARTED', lastActivityAt: daysAgo(69).toISOString() },
      createdDaysAgo: 48, resolvedDaysAgo: 41,
    },
  ].filter((item) => item !== undefined)
  for (const item of resolvedPlan) {
    const created = await prisma.recommendation.create({
      data: {
        type: item.type, objectType: 'Cooperation', objectId: item.cooperationId, ruleKey: item.ruleKey,
        title: item.title, description: item.description, justification: item.justification,
        priority: item.priority, confidence: 'HIGH', status: item.status, relatedData: item.relatedData,
        resolutionComment: item.comment, cooperationId: item.cooperationId,
        resolvedById: manager.id, resolvedAt: daysAgo(item.resolvedDaysAgo),
        createdAt: daysAgo(item.createdDaysAgo), updatedAt: daysAgo(item.resolvedDaysAgo),
      },
    })
    await prisma.auditLog.create({
      data: {
        userId: manager.id, action: 'recommendation.status.change', objectType: 'Recommendation',
        objectId: created.id, payload: { from: 'NEW', to: item.status, ruleKey: item.ruleKey },
        createdAt: daysAgo(item.resolvedDaysAgo),
      },
    })
  }
}

/**
 * Примеры для «пустых содержательных таблиц» решения 141: реестр запросов
 * субъектов (DSAR), одобрения «четыре глаза», обученная модель прогноза,
 * отметка «не дубль» и слияние-с-отменой вуза — всё через настоящие сервисные
 * функции (те же, что вызывает API), а не прямой INSERT: тогда данные проходят
 * ту же валидацию и пишут тот же журнал, что и на реальном стенде.
 */
async function seedGovernanceExamples(users: SeedUsers, universityRep: SeedUser): Promise<void> {
  console.log('Одобрения, запросы субъектов, прогноз, качество данных...')
  const admin: CurrentUser = { id: users.admin.id, email: users.admin.email, fullName: users.admin.fullName, role: 'ADMIN', universityId: null }
  const admin2: CurrentUser = { id: users.admin2.id, email: users.admin2.email, fullName: users.admin2.fullName, role: 'ADMIN', universityId: null }
  const analyst: CurrentUser = { id: users.analyst.id, email: users.analyst.email, fullName: users.analyst.fullName, role: 'ANALYST', universityId: null }
  const rep: CurrentUser = {
    id: universityRep.id, email: universityRep.email, fullName: universityRep.fullName,
    role: universityRep.role, universityId: universityRep.universityId,
  }

  // ── DSAR: реестр запросов субъектов (решение 116) — три примера, разные виды,
  // статусы, каналы и типы субъекта.
  // 1. Представитель вуза сам выгружает свои данные из кабинета — EXPORT/COMPLETED/SELF_SERVICE.
  await exportOwnData(rep, { address: null }, daysAgo(2))
  // 2. Письмо с просьбой обезличить контакт вуза — ERASE/OPEN/LETTER: срок ещё не истёк,
  // запрос виден в реестре как открытый.
  const letterContact = await prisma.contact.findFirstOrThrow({
    where: { email: 'partners@mtuci.example.invalid' },
    select: { id: true },
  })
  await registerRequest(
    admin,
    { subjectType: 'CONTACT', subjectId: letterContact.id, kind: 'ERASE', receivedAt: daysAgo(3).toISOString() },
    daysAgo(2),
  )
  // 3. Уволенный сотрудник обезличен администратором — ERASE/COMPLETED/ADMIN, USER.
  await eraseUser(admin, users.formerEmployee.id, { confirm: users.formerEmployee.email }, daysAgo(1))
  const dsarRequests = await prisma.dsarRequest.count()

  // ── Approvals: «четыре глаза» (решение 133) — один открытый, один одобренный,
  // не использованный (сама операция повышения роли в демо не выполняется).
  // createdAt строки — DEFAULT now() в базе, backdate тут невозможен без прямого
  // UPDATE — оставляем настоящее «сейчас», как и было бы при живом запросе.
  await requestApproval(admin, { action: 'user.grant_admin', payload: { userId: users.analyst.id } })
  const toApprove = await requestApproval(admin, { action: 'user.grant_admin', payload: { userId: users.manager.id } })
  await approveApproval(admin2, toApprove.id)
  const approvals = await prisma.approval.count()

  // ── Прогноз (решение 135): обучение на только что залитой истории этапов —
  // настоящая функция, не подставные числа; ворота публикации решают сами,
  // публиковать модель или показывать «недостаточно данных».
  const forecast = await trainForecastModels(null)
  const forecastModels = forecast.models.length

  // ── Качество данных (решение 134): «Java»/«JavaScript» — единственная пара
  // навыков, которую находит нечёткий поиск даже на пониженном пороге (0.3
  // вместо 0.4 по умолчанию) — реальный дубль-кандидат, отклонённый аналитиком.
  // При пороге по умолчанию эта пара не показывается вовсе, поэтому дубль
  // остаётся невидимым в обычном отчёте — только в журнале решений.
  const javaPair = await findDuplicates(analyst, {
    entity: 'skill',
    threshold: 0.3,
    includeDismissed: undefined,
    includeArchived: false,
  })
  const [firstCandidate] = javaPair.data
  if (firstCandidate) {
    const manager: CurrentUser = {
      id: users.manager.id, email: users.manager.email, fullName: users.manager.fullName,
      role: users.manager.role, universityId: users.manager.universityId,
    }
    await dismissDuplicate(manager, {
      entity: 'skill',
      firstId: firstCandidate.a.id,
      secondId: firstCandidate.b.id,
      comment: 'Java и JavaScript — разные языки программирования, несмотря на схожее название',
    })
  }
  const duplicateDismissals = await prisma.duplicateDismissal.count()

  // ── Слияние вуза с отменой (решение 134): показывает обе операции — перенос
  // и отмену по журналу — без единого следа в реестре. Источник — КубГТУ (в
  // архиве, дубль тут ни при чём, просто пример механики); цель обязана быть
  // действующей (правило слияния), поэтому берём любой активный вуз — Иннополис.
  //
  // Правило слияния отказывает, если у обоих вузов есть ИНН и они разные
  // (решение 134 — «это разные организации, а не дубли»): ровно то, что решение
  // 141 только что включило для всех 19 вузов. Чтобы пример вообще прошёл эту
  // проверку, ИНН источника на время примера снимается и возвращается назад
  // после отмены — checksum-утилита (prisma/demo/random.ts) детерминирована,
  // так что значение то же, что было. Отмена в ту же секунду возвращает обоих
  // ровно к прежнему состоянию, включая ИНН, который undo знать не может.
  const kubstu = await prisma.university.findFirstOrThrow({ where: { shortName: 'КубГТУ' }, select: { id: true, inn: true } })
  const innopolis = await prisma.university.findFirstOrThrow({ where: { shortName: 'Иннополис' }, select: { id: true } })
  await prisma.university.update({ where: { id: kubstu.id }, data: { inn: null } })
  const merged = await mergeUniversities(admin, { sourceId: kubstu.id, targetId: innopolis.id }, daysAgo(10))
  await undoUniversityMerge(admin, merged.id, daysAgo(9))
  await prisma.university.update({ where: { id: kubstu.id }, data: { inn: kubstu.inn } })
  const universityMerges = await prisma.universityMerge.count()

  console.log(
    `  запросов субъектов: ${dsarRequests}, одобрений: ${approvals}, моделей прогноза: ${forecastModels}, ` +
      `отметок «не дубль»: ${duplicateDismissals}, слияний вузов (с отменой): ${universityMerges}`,
  )
}

/** Итог заливки: число записей, id демо-пользователей и пароль (если он не задан через env). */
async function printSummary(users: SeedUsers, universityRep: SeedUser): Promise<void> {
  const { admin, manager, analyst, customPassword, DEMO_PASSWORD } = users
  const counts = {
    Вузы: await prisma.university.count(),
    Программы: await prisma.educationalProgram.count(),
    Навыки: await prisma.skill.count(),
    'Рыночные показатели': await prisma.marketDemand.count(),
    'IT-продукты': await prisma.iTProduct.count(),
    Связки: await prisma.cooperation.count(),
    Этапы: await prisma.workflowStage.count(),
    'Пункты чек-листов': await prisma.task.count(),
    'История этапов': await prisma.stageHistory.count(),
    Документы: await prisma.document.count(),
    Встречи: await prisma.meeting.count(),
    'Заявки на обучение': await prisma.application.count(),
    'Записи журнала': await prisma.auditLog.count(),
    'Печати журнала': await prisma.auditSeal.count(),
    Пользователи: await prisma.user.count(),
    Рекомендации: await prisma.recommendation.count(),
    'Запросы субъектов (DSAR)': await prisma.dsarRequest.count(),
    Одобрения: await prisma.approval.count(),
    'Модели прогноза': await prisma.forecastModel.count(),
    'Источники данных': await prisma.dataSource.count(),
  }
  console.log('\nДемонстрационные данные загружены:')
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  ${name}: ${value}`)
  }
  console.log(
    `\nДемо-пользователи (cookie skilllink_user):` +
      `\n  ADMIN          ${admin.id}` +
      `\n  MANAGER        ${manager.id}` +
      `\n  ANALYST        ${analyst.id}` +
      `\n  UNIVERSITY_REP ${universityRep.id} (${'СПбГУТ'})`,
  )
  console.log(
    customPassword
      ? '\nПароль всех демо-пользователей задан через SEED_DEMO_PASSWORD — в журнал не выводится.'
      : `\nПароль всех демо-пользователей: ${DEMO_PASSWORD}`,
  )
  console.log('\nВсе записи помечены isMock = true и не являются подтверждённой статистикой.')
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  console.log('Очистка демонстрационных данных...')
  await clean()

  const users = await seedUsers()
  const mockSource = await seedDataSources()
  const skillId = await seedSkills()
  const products = await seedProducts(skillId)
  const vendors = await seedVendors(prisma)
  const courses = await seedSchoolCourses(prisma, now)
  console.log(`  вендоры (решение 132): ${vendors.vendors}, их продуктов ${vendors.products}, контактов ${vendors.contacts}; курсов ${courses.courses}, заказов с сайта ${courses.orders}`)
  const { universityId, universityCreatedAt } = await seedUniversities()
  await seedContactBases(users.manager, universityId, universityCreatedAt)
  await seedSecondaryContacts(users.manager, universityId, universityCreatedAt)
  const programId = await seedPrograms(skillId, universityId, universityCreatedAt)
  const cooperations = await seedCooperations(products, users.manager, users.manager2, universityId, programId)
  const universityRep = await seedUniversityRep(users.demoPasswordHash, universityId)
  await seedDocuments(cooperations, users.manager, universityId)
  await seedMeetings(cooperations, users.manager, universityId)
  await seedApplications(universityId, programId)
  // Первая печать журнала (решение 115, решение 141): снимается в середине заливки,
  // до расширенного набора — вторая, в конце, покажет другое число строк и хеш.
  await auditSeal(prisma)
  if (process.env.SEED_DQ_CASES?.trim() === '1') {
    await seedDataQualityCases(universityId)
  } else {
    console.log('Почти дубли для проверки качества данных: пропущено (SEED_DQ_CASES=1 — включить)')
  }

  // Расширенный набор (решение 131): ещё 12 вузов, 40 связок и полгода истории.
  // Сценарные объекты выше не трогаются — это дополнение к ним.
  console.log('Расширенный демо-набор...')
  const extended = generateDemoData({ anchor: now, stableUntil: STABLE_UNTIL })
  const inserted = await insertExtendedDemo(prisma, extended, {
    users: { manager: users.manager, manager2: users.manager2 },
    baseSkillId: skillId,
    baseProducts: products,
    baseUniversityId: universityId,
    mockSource,
  })

  await seedRecommendations(cooperations, users.manager)
  const resolved = await insertResolvedRecommendations(prisma, extended, {
    manager: users.manager,
    cooperationId: inserted.cooperationId,
  })
  console.log(`  закрытых из прошлого: ${resolved}`)
  // Решение 119: история решений по правилам — обучение видно на стенде сразу.
  await seedRecommendationStats(now)
  await seedGovernanceExamples(users, universityRep)
  // Вторая печать журнала — после всего: другой headSeq/rowCount, чем у первой.
  await auditSeal(prisma)
  await printSummary(users, universityRep)
  console.log(`\nЗаливка заняла ${((Date.now() - startedAt) / 1000).toFixed(1)} с.`)
}

main()
  .catch((error) => {
    console.error('Ошибка загрузки демонстрационных данных:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
