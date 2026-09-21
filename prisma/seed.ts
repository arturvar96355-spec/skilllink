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
import { PrismaClient } from '../src/generated/prisma/client'
import { WORKFLOW_STAGES } from '../src/shared/config/workflow.config'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Не задана переменная окружения DATABASE_URL')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY)
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY)

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
  const DEMO_PASSWORD = 'skilllink'
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
      fullName: 'Наблюдатель Демонстрационный',
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
        skills: {
          create: [
            { skillId: skillId('CI/CD'), relevance: 'CORE' },
            { skillId: skillId('Docker'), relevance: 'CORE' },
            { skillId: skillId('Тестирование ПО'), relevance: 'RELATED' },
          ],
        },
      },
    }),
  }

  console.log('Вузы, контакты и программы...')
  const universitySeed = [
    {
      key: 'spbgu',
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
      name: 'Донской государственный технический университет',
      shortName: 'ДГТУ',
      city: 'Ростов-на-Дону',
      region: 'Ростовская область',
      status: 'PAUSED' as const,
      directionCount: 22,
      studentCount: 16400,
      contact: { fullName: 'Петренко Виктор Иванович', position: 'Проректор по развитию' },
    },
  ]

  const universities = new Map<string, string>()
  for (const item of universitySeed) {
    const created = await prisma.university.create({
      data: {
        name: item.name,
        shortName: item.shortName,
        city: item.city,
        region: item.region,
        address: `${item.city}, адрес указан условно`,
        website: `https://example.invalid/${item.key}`,
        status: item.status,
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
  ]

  const programs = new Map<string, string>()
  for (const item of programSeed) {
    const hasMetrics =
      item.applicationCount !== null || item.studentCount !== null || item.groupCount !== null
    const created = await prisma.educationalProgram.create({
      data: {
        universityId: universityId(item.university),
        name: item.name,
        code: item.code,
        direction: item.direction,
        level: item.level,
        durationMonths: item.durationMonths,
        status: 'ACTIVE',
        applicationCount: item.applicationCount,
        studentCount: item.studentCount,
        groupCount: item.groupCount,
        metricsSource: hasMetrics ? 'MOCK' : null,
        metricsUpdatedAt: hasMetrics ? daysAgo(14) : null,
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
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED'
    goal: string
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
      startedDaysAgo: 210, firstContactDaysAgo: 210, classesStartInDays: 30,
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
      university: 'mtuci', program: 'mtuci-data', productId: products.dataLab.id,
      responsibleId: analyst.id, status: 'ACTIVE',
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
        startedAt,
        firstContactAt:
          item.firstContactDaysAgo === null ? null : daysAgo(item.firstContactDaysAgo),
        classesStartAt:
          item.classesStartInDays === null ? null : daysAhead(item.classesStartInDays),
        targetDate: item.classesStartInDays === null ? null : daysAhead(item.classesStartInDays),
        isMock: true,
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

    for (const definition of WORKFLOW_STAGES) {
      const number = definition.number
      const isControl = number === 14

      let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED' =
        'NOT_STARTED'
      if (item.cancelledStages?.includes(number)) status = 'CANCELLED'
      else if (number <= item.completedUpTo) status = 'COMPLETED'
      else if (item.blockedStage === number) status = 'BLOCKED'
      else if (number === item.completedUpTo + 1 && !isControl) status = 'IN_PROGRESS'

      const isOverdue = item.overdueStages?.includes(number) ?? false
      const deadline = isOverdue
        ? daysAgo(Math.max(3, item.startedDaysAgo - definition.normativeDays))
        : new Date(startedAt.getTime() + definition.normativeDays * DAY)

      // Контрольный этап считается по остальным — здесь выставляется то же правило.
      const controlStatus =
        item.completedUpTo >= 13 ? 'COMPLETED' : item.completedUpTo > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'

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
          startedAt: finalStatus === 'NOT_STARTED' ? null : daysAgo(item.startedDaysAgo - number),
          completedAt:
            finalStatus === 'COMPLETED'
              ? item.lateStages?.includes(number)
                // Закрыт с опозданием: на несколько дней позже собственного срока.
                ? new Date(deadline.getTime() + (3 + (number % 5)) * DAY)
                : daysAgo(item.startedDaysAgo - number - 1)
              : null,
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
                      sortOrder: index,
                      isDone: finalStatus === 'COMPLETED',
                      doneAt: finalStatus === 'COMPLETED' ? daysAgo(item.startedDaysAgo - number) : null,
                      doneById: finalStatus === 'COMPLETED' ? item.responsibleId : null,
                    })),
                  },
                },
              }
            : {}),
        },
      })

      if (finalStatus !== 'NOT_STARTED') {
        const changedAt = daysAgo(Math.max(1, item.startedDaysAgo - number))

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
      universityId: universityId('spbgu'),
    },
  })

  // ─── Документы и встречи ───────────────────────────────────────────────────
  console.log('Документы и встречи...')

  const docPlan: Array<{
    coopIndex: number
    type: 'NDA' | 'AGREEMENT' | 'ANNEX' | 'ACT' | 'LICENSE' | 'CURRICULUM' | 'METHODOLOGY'
    title: string
    status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED'
    version: string
    daysAgoIssued: number
  }> = [
    { coopIndex: 0, type: 'NDA', title: 'Соглашение о неразглашении', status: 'SIGNED', version: '1', daysAgoIssued: 190 },
    { coopIndex: 0, type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'SIGNED', version: '2', daysAgoIssued: 170 },
    { coopIndex: 0, type: 'LICENSE', title: 'Лицензия на IT-продукт', status: 'SIGNED', version: '1', daysAgoIssued: 120 },
    { coopIndex: 1, type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'REVIEW', version: '1', daysAgoIssued: 20 },
    { coopIndex: 2, type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'SIGNED', version: '1', daysAgoIssued: 60 },
    { coopIndex: 2, type: 'LICENSE', title: 'Лицензия на облачную платформу', status: 'APPROVED', version: '1', daysAgoIssued: 15 },
    { coopIndex: 3, type: 'CURRICULUM', title: 'Обновлённый учебный план', status: 'DRAFT', version: '1', daysAgoIssued: 10 },
    { coopIndex: 4, type: 'AGREEMENT', title: 'Договор о сотрудничестве', status: 'REJECTED', version: '1', daysAgoIssued: 25 },
  ]

  for (const plan of docPlan) {
    const coop = createdCooperations[plan.coopIndex]
    if (!coop) continue

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
        signedAt: plan.status === 'SIGNED' ? daysAgo(plan.daysAgoIssued - 5) : null,
      },
    })

    // История статусов: путь от черновика до текущего состояния.
    const path: Array<'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED'> =
      plan.status === 'SIGNED'
        ? ['REVIEW', 'APPROVED', 'SIGNED']
        : plan.status === 'APPROVED'
          ? ['REVIEW', 'APPROVED']
          : plan.status === 'REJECTED'
            ? ['REVIEW', 'REJECTED']
            : plan.status === 'REVIEW'
              ? ['REVIEW']
              : []

    let previous: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SIGNED' | 'REJECTED' = 'DRAFT'
    let offset = plan.daysAgoIssued
    for (const step of path) {
      offset -= 2
      await prisma.documentHistory.create({
        data: {
          documentId: document.id,
          fromStatus: previous,
          toStatus: step,
          comment:
            step === 'REJECTED' ? 'Требуется приложение с перечнем материалов' : 'Демонстрационные данные',
          changedById: manager.id,
          changedAt: daysAgo(Math.max(1, offset)),
        },
      })
      previous = step
    }
  }

  const meetingPlan: Array<{
    coopIndex: number
    daysAgoDate: number
    topic: string
    format: 'ONLINE' | 'OFFLINE' | 'CALL' | 'CORRESPONDENCE'
    result: string
    nextAction: string | null
    nextActionInDays: number | null
  }> = [
    {
      coopIndex: 0, daysAgoDate: 195, topic: 'Первичное знакомство с кафедрой', format: 'ONLINE',
      result: 'Кафедра подтвердила интерес, назначен ответственный',
      nextAction: 'Направить пакет документов', nextActionInDays: -188,
    },
    {
      coopIndex: 0, daysAgoDate: 120, topic: 'Передача учебных материалов', format: 'OFFLINE',
      result: 'Материалы переданы, лицензия активирована',
      nextAction: null, nextActionInDays: null,
    },
    {
      coopIndex: 2, daysAgoDate: 40, topic: 'Согласование условий лицензии', format: 'CALL',
      result: 'Юридическая служба вуза запросила дополнительные сведения',
      nextAction: 'Подготовить ответ юридической службе', nextActionInDays: 7,
    },
    {
      coopIndex: 4, daysAgoDate: 30, topic: 'Обсуждение DevOps-практик в программе', format: 'ONLINE',
      result: 'Вуз просит расширить блок по контейнеризации',
      nextAction: 'Согласовать обновлённую программу', nextActionInDays: 14,
    },
  ]

  for (const plan of meetingPlan) {
    const coop = createdCooperations[plan.coopIndex]
    if (!coop) continue

    const contact = await prisma.contact.findFirst({
      where: { universityId: universityId(coop.universityKey) },
      select: { id: true },
    })

    await prisma.meeting.create({
      data: {
        cooperationId: coop.id,
        universityId: universityId(coop.universityKey),
        date: daysAgo(plan.daysAgoDate),
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

  // ─── Застоявшаяся связка ───────────────────────────────────────────────────
  // updatedAt проставляется Prisma автоматически, поэтому дату последнего изменения
  // для демонстрации правила «связка без движения» сдвигаем назад запросом.
  console.log('Сдвиг даты изменения для демонстрации застоя...')
  const stalled = await prisma.cooperation.findFirst({
    where: { universityId: universityId('urfu') },
    select: { id: true },
  })
  if (stalled) {
    await prisma.$executeRaw`
      UPDATE cooperations SET updated_at = ${daysAgo(30)} WHERE id = ${stalled.id}
    `
  }

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
  console.log(`\nПароль всех демо-пользователей: ${DEMO_PASSWORD}`)
  console.log('\nВсе записи помечены isMock = true и не являются подтверждённой статистикой.')
}

main()
  .catch((error) => {
    console.error('Ошибка загрузки демонстрационных данных:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
