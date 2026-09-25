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
import { computeControlStatus } from '@/modules/workflow/workflow.rules'
import { PrismaClient } from '../src/generated/prisma/client'
import { WORKFLOW_STAGES } from '../src/shared/config/workflow.config'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Не задана переменная окружения DATABASE_URL')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY)
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY)

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
  await prisma.auditLog.deleteMany()
  await prisma.stageHistory.deleteMany()
  await prisma.task.deleteMany()
  await prisma.workflowStage.deleteMany()
  await prisma.documentHistory.deleteMany()
  await prisma.document.deleteMany()
  await prisma.meetingParticipant.deleteMany()
  await prisma.meeting.deleteMany()
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
  await prisma.user.deleteMany()
}

async function main(): Promise<void> {
  console.log('Очистка демонстрационных данных...')
  await clean()

  // ─── Пользователи ──────────────────────────────────────────────────────────
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

  // ─── Источники данных ──────────────────────────────────────────────────────
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

  // ─── Навыки ────────────────────────────────────────────────────────────────
  console.log('Навыки...')
  const skillSeed: Array<{ name: string; category: string; description: string }> = [
    { name: 'Python', category: 'Языки программирования', description: 'Разработка на Python' },
    { name: 'Java', category: 'Языки программирования', description: 'Разработка на Java' },
    { name: 'JavaScript', category: 'Языки программирования', description: 'Веб-разработка' },
    { name: 'SQL', category: 'Базы данных', description: 'Запросы к реляционным СУБД' },
    { name: 'PostgreSQL', category: 'Базы данных', description: 'Администрирование PostgreSQL' },
    { name: 'Docker', category: 'DevOps', description: 'Контейнеризация приложений' },
    { name: 'Kubernetes', category: 'DevOps', description: 'Оркестрация контейнеров' },
    { name: 'CI/CD', category: 'DevOps', description: 'Непрерывная интеграция и поставка' },
    { name: 'Linux', category: 'Системное администрирование', description: 'Работа в Linux' },
    { name: 'Сетевые технологии', category: 'Инфраструктура', description: 'Сети передачи данных' },
    { name: 'Информационная безопасность', category: 'Безопасность', description: 'Защита систем' },
    { name: 'Машинное обучение', category: 'Данные', description: 'Построение моделей' },
    { name: 'Аналитика данных', category: 'Данные', description: 'Обработка и визуализация' },
    { name: 'Облачные платформы', category: 'Инфраструктура', description: 'Работа с облаками' },
    { name: 'Микросервисы', category: 'Архитектура', description: 'Проектирование микросервисов' },
    { name: 'Тестирование ПО', category: 'Качество', description: 'Автоматизация тестирования' },
    { name: 'Управление проектами', category: 'Процессы', description: 'Методологии управления' },
    { name: 'Бизнес-анализ', category: 'Процессы', description: 'Сбор и анализ требований' },
  ]

  const skills = new Map<string, string>()
  for (const item of skillSeed) {
    const created = await prisma.skill.create({ data: item })
    skills.set(item.name, created.id)
  }
  const skillId = (name: string): string => {
    const id = skills.get(name)
    if (!id) throw new Error(`Навык не найден: ${name}`)
    return id
  }

  // ─── Рыночная востребованность ─────────────────────────────────────────────
  console.log('Рыночная востребованность навыков...')
  const demandByPeriod: Record<string, Record<string, number>> = {
    '2025-Q4': {
      Python: 8200, Java: 6100, JavaScript: 7400, SQL: 9100, PostgreSQL: 6800,
      Docker: 5600, Kubernetes: 6300, 'CI/CD': 3400, Linux: 5200,
      'Сетевые технологии': 2600, 'Информационная безопасность': 4100,
      'Машинное обучение': 3100, 'Аналитика данных': 4800, 'Облачные платформы': 3600,
      Микросервисы: 2900, 'Тестирование ПО': 3300, 'Управление проектами': 2400,
      'Бизнес-анализ': 2100,
    },
    '2026-Q1': {
      Python: 9400, Java: 6000, JavaScript: 7800, SQL: 9600, PostgreSQL: 7400,
      Docker: 6400, Kubernetes: 7900, 'CI/CD': 4100, Linux: 5400,
      'Сетевые технологии': 2700, 'Информационная безопасность': 5300,
      'Машинное обучение': 4200, 'Аналитика данных': 5600, 'Облачные платформы': 4400,
      Микросервисы: 3400, 'Тестирование ПО': 3500, 'Управление проектами': 2500,
      'Бизнес-анализ': 2200,
    },
  }

  for (const [period, values] of Object.entries(demandByPeriod)) {
    for (const [name, value] of Object.entries(values)) {
      await prisma.marketDemand.create({
        data: {
          skillId: skillId(name),
          period,
          value,
          unit: 'вакансий',
          region: 'Россия',
          source: 'Демонстрационный набор вакансий',
          dataSourceId: mockSource.id,
          confidence: 'LOW',
          isMock: true,
        },
      })
    }
  }

  // ─── IT-продукты ───────────────────────────────────────────────────────────
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

  // Даты записи — по сюжету, а не момент заливки: вуз заведён до первой связки
  // с ним. Иначе у всех вузов «Заведён 25.09, 00:25», а первый контакт — в мае.
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

  // Программы. У части показатели намеренно не заполнены — проверка поведения «Нет данных».
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
  ]

  const programs = new Map<string, string>()
  for (const item of programSeed) {
    const hasMetrics =
      item.applicationCount !== null || item.studentCount !== null || item.groupCount !== null
    // У СПбГУТ есть представитель в кабинете вуза (ниже): показатели набора внёс
    // и подтвердил сам вуз — это данные вуза, а не оценка. Иначе одна и та же цифра
    // «420 заявок» в карточке программы шла с пометкой «оценка», а в кабинете —
    // «подтверждена вузом» (ТЗ Артура, п. 2). У остальных вузов кабинета нет.
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
          create: item.skills.map(([name, level, importance]) => ({
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

  // ─── Связки и этапы ────────────────────────────────────────────────────────
  console.log('Связки и этапы...')

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
      // значит, занятия начались. Раньше начало стояло через 30 дней — «Проведение
      // занятий» было завершено до начала занятий.
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
  ]

  const createdCooperations: Array<{ key: string; id: string; universityKey: string }> = []

  for (const item of cooperationSeed) {
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
        // началась работа, и с тех пор не правилась. Иначе у всех связок «изменена
        // сегодня», и застой по этапам в наборе не виден (решение 56).
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

    createdCooperations.push({
      key: `${item.university}-${item.program}`,
      id: cooperation.id,
      universityKey: item.university,
    })

    type SeedStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED'
    const seedStatus = (number: number): SeedStageStatus => {
      if (item.cancelledStages?.includes(number)) return 'CANCELLED'
      if (number <= item.completedUpTo) return 'COMPLETED'
      if (item.blockedStage === number) return 'BLOCKED'
      if (number === item.completedUpTo + 1 && !item.nextStageNotStarted) return 'IN_PROGRESS'
      return 'NOT_STARTED'
    }
    // Контрольный этап — тем же правилом, что в системе (computeControlStatus),
    // а не своей копией: копия считала по номеру последнего закрытого этапа,
    // и у связки с начатым первым этапом этап 14 оставался «Не начат».
    const controlStatus = computeControlStatus(
      WORKFLOW_STAGES.filter((definition) => definition.number !== 14).map((definition) =>
        seedStatus(definition.number),
      ),
    )

    // Сроки этапов. Нормативные — от начала связки, но этапы 11–14 (занятия
    // и то, что идёт после них) привязаны к началу занятий: «Проведение занятий»
    // со сроком раньше начала занятий — неправда на экране (ТЗ Артура, п. 2).
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
    // незадолго до своего срока, а опоздавший — через несколько дней после.
    // Раньше все этапы закрывались в первые две недели связки: «Проведение
    // занятий» оказывалось завершённым за полгода до начала занятий, а за
    // последний месяц не закрывалось ничего и тренд главной был пуст.
    // Кто закрыт в срок, а кто с опозданием — как раньше, доля «в срок» та же.
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
          deadline,
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
        const changedAt = dates.completedAt ?? dates.startedAt ?? startedAt

        await prisma.stageHistory.create({
          data: {
            stageId: stage.id,
            fromStatus: 'NOT_STARTED',
            toStatus: finalStatus,
            comment: 'Демонстрационные данные',
            changedById: item.responsibleId,
            changedAt,
          },
        })

        // То же событие пишется и в журнал действий — ровно как делает работающая
        // система. Иначе демо-набор внутренне противоречив: история этапов есть,
        // а журнал пуст, и администратор видит пустой раздел при десятках
        // завершённых этапов.
        await prisma.auditLog.create({
          data: {
            userId: item.responsibleId,
            action: 'stage.status.change',
            objectType: 'WorkflowStage',
            objectId: stage.id,
            payload: { from: 'NOT_STARTED', to: finalStatus, stageNumber: number },
            createdAt: changedAt,
          },
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
  }

  // ─── Представитель вуза ────────────────────────────────────────────────────
  // Создаётся после вузов: роли UNIVERSITY_REP обязательно нужен свой вуз (решение 9).
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

  // ─── Документы и встречи ───────────────────────────────────────────────────
  console.log('Документы и встречи...')

  /**
   * Связка по ключу «вуз-программа», а не по номеру в списке.
   *
   * Документы и встречи раньше ссылались на номер. 22.09.2026 в начало списка
   * вставили завершённую связку КНИТУ-КАИ, номера съехали на один, и всё
   * уехало к соседям: у «Программной инженерии» СПбГУТ, где подписание ещё
   * идёт, договор значился подписанным, а у связки на этапе 13 — «на
   * согласовании». Неизвестный ключ роняет заливку, а не пропускается молча.
   */
  const cooperationByKey = (key: string) => {
    const found = createdCooperations.find((item) => item.key === key)
    if (!found) throw new Error(`В демонстрационном наборе нет связки ${key}`)
    return found
  }

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
    const coop = cooperationByKey(plan.coopKey)

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
        // Даты записи — по сюжету: заведён в день выпуска, обновлён последней
        // сменой статуса. Иначе у всех документов «Обновлён 25.09, 00:25».
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
    const coop = cooperationByKey(plan.coopKey)

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
          plan.nextActionInDays === null ? null : daysAhead(plan.nextActionInDays),
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

  // Застой не подделывается. Раньше у связки УрФУ дату изменения сдвигали на 30 дней
  // назад, и правило выдавало «Связка без движения 30 дн.» о связке, созданной 5 дней
  // назад, где этап 1 начат 4 дня назад. Правило смотрит на движение по этапам
  // (решение 56) и само находит связку, где работа действительно стоит.

  // ─── Заявки на обучение ────────────────────────────────────────────────────
  // applicationCount программы считается по заявкам (решение 9), поэтому демо-данные
  // обязаны быть согласованы: для каждой программы с заявками создаётся запись
  // ровно на то количество, которое проставлено в показателе. Иначе кабинет вуза
  // пересчитает показатель и цифра на демонстрации изменится на глазах у зрителей.
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

  // ─── Итог ──────────────────────────────────────────────────────────────────
  // ─── Рекомендации ──────────────────────────────────────────────────────────
  // Прогоняем настоящий движок правил по посеянным данным, а не сочиняем записи.
  //
  // Без этого шага свежая демонстрация открывается с пустым блоком «приоритетные
  // действия» на дашборде: рекомендации появляются только после явной генерации,
  // и до первого нажатия система выглядит так, будто раздел не работает.
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
  const pausedCoop = createdCooperations.find((item) => item.key === 'rostov-rostov-it')
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
  const completedCoop = createdCooperations.find((item) => item.key === 'kazan-kazan-networks')
  const cancelledCoop = createdCooperations.find((item) => item.key === 'nsu-nsu-soft')
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

  const counts = {
    Вузы: await prisma.university.count(),
    Программы: await prisma.educationalProgram.count(),
    Навыки: await prisma.skill.count(),
    'Рыночные показатели': await prisma.marketDemand.count(),
    'IT-продукты': await prisma.iTProduct.count(),
    Связки: await prisma.cooperation.count(),
    Этапы: await prisma.workflowStage.count(),
    'Пункты чек-листов': await prisma.task.count(),
    Документы: await prisma.document.count(),
    Встречи: await prisma.meeting.count(),
    Пользователи: await prisma.user.count(),
    Рекомендации: await prisma.recommendation.count(),
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

main()
  .catch((error) => {
    console.error('Ошибка загрузки демонстрационных данных:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
