/**
 * Наполняет базу объёмом, близким к реальному, чтобы проверять скорость на данных,
 * а не на демонстрационных сорока записях.
 *
 * Работает ТОЛЬКО с базой, в имени которой есть `volume`: иначе один запуск
 * не туда стёр бы демонстрационные данные.
 *
 *   createdb skilllink_volume
 *   DATABASE_URL="postgresql://…/skilllink_volume" npm run db:deploy
 *   DATABASE_URL="postgresql://…/skilllink_volume" npm run volume
 *   DATABASE_URL="postgresql://…/skilllink_volume" npm run dev
 *   npm run bench
 */
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { WORKFLOW_STAGES } from '@/shared/config/workflow.config'

const url = process.env.DATABASE_URL ?? ''
const databaseName = url.split('/').pop()?.split('?')[0] ?? ''

if (!databaseName.includes('volume')) {
  console.error(
    'Отказ: в имени базы нет «volume».\n' +
      `Сейчас: ${databaseName || '(не задано)'}\n` +
      'Скрипт стирает все данные — укажите отдельную базу, а не рабочую.',
  )
  process.exit(1)
}

const UNIVERSITIES = Number(process.env.VOLUME_UNIVERSITIES ?? 120)
const PROGRAMS_PER_UNIVERSITY = Number(process.env.VOLUME_PROGRAMS ?? 4)
const COOPERATIONS_PER_UNIVERSITY = Number(process.env.VOLUME_COOPERATIONS ?? 3)

const REGIONS = ['Санкт-Петербург', 'Москва', 'Татарстан', 'Свердловская область', 'Приморский край']
const LEVELS = ['BACHELOR', 'MASTER', 'SPO', 'DPO'] as const

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length]!
}

/** Каждое десятое значение оставляем пустым: «Нет данных» должно встречаться и на объёме. */
function metric(index: number, base: number): number | null {
  return index % 10 === 0 ? null : base + (index % 97)
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: url })
  const prisma = new PrismaClient({ adapter })
  const startedAt = Date.now()

  console.log(`База: ${databaseName}`)
  // Удаление в порядке зависимостей, а не TRUNCATE CASCADE: тот сносит и таблицу
  // пользователей, потому что она ссылается на вузы, — и делает это независимо
  // от `ON DELETE SET NULL`. Пользователи нужны: связкам требуется ответственный.
  console.log('Очистка…')
  await prisma.stageHistory.deleteMany()
  await prisma.task.deleteMany()
  await prisma.workflowStage.deleteMany()
  await prisma.meetingParticipant.deleteMany()
  await prisma.meeting.deleteMany()
  await prisma.documentHistory.deleteMany()
  await prisma.document.deleteMany()
  await prisma.recommendation.deleteMany()
  await prisma.cooperation.deleteMany()
  await prisma.programSkill.deleteMany()
  await prisma.application.deleteMany()
  await prisma.educationalProgram.deleteMany()
  await prisma.contact.deleteMany()
  // Журнал слияний ссылается на вузы (решение 134): без его очистки вузы не удалить.
  await prisma.universityMerge.deleteMany()
  await prisma.university.deleteMany()

  const admin = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'MANAGER'] } } })
  if (!admin) {
    console.error('Нет пользователя с ролью ADMIN или MANAGER — выполните npm run db:seed.')
    process.exit(1)
  }

  console.log(`Вузы: ${UNIVERSITIES}…`)
  await prisma.university.createMany({
    data: Array.from({ length: UNIVERSITIES }, (_, index) => ({
      id: `vol-u-${index}`,
      name: `Нагрузочный университет № ${index}`,
      shortName: `НУ-${index}`,
      city: `Город ${index % 40}`,
      region: pick(REGIONS, index),
      status: 'ACTIVE' as const,
      isMock: true,
    })),
  })

  const programCount = UNIVERSITIES * PROGRAMS_PER_UNIVERSITY
  console.log(`Программы: ${programCount}…`)
  await prisma.educationalProgram.createMany({
    data: Array.from({ length: programCount }, (_, index) => {
      const universityIndex = Math.floor(index / PROGRAMS_PER_UNIVERSITY)
      return {
        id: `vol-p-${index}`,
        universityId: `vol-u-${universityIndex}`,
        name: `Нагрузочная программа № ${index}`,
        level: pick(LEVELS, index),
        status: 'ACTIVE' as const,
        applicationCount: metric(index, 20),
        studentCount: metric(index + 1, 60),
        groupCount: metric(index + 2, 2),
        metricsSource: 'MOCK' as const,
        isMock: true,
      }
    }),
  })

  const cooperationCount = UNIVERSITIES * COOPERATIONS_PER_UNIVERSITY
  console.log(`Связки: ${cooperationCount}…`)
  await prisma.cooperation.createMany({
    data: Array.from({ length: cooperationCount }, (_, index) => {
      const universityIndex = Math.floor(index / COOPERATIONS_PER_UNIVERSITY)
      return {
        id: `vol-c-${index}`,
        universityId: `vol-u-${universityIndex}`,
        programId: `vol-p-${universityIndex * PROGRAMS_PER_UNIVERSITY}`,
        status: 'ACTIVE' as const,
        responsibleId: admin.id,
        isMock: true,
      }
    }),
  })

  console.log(`Этапы: ${cooperationCount * WORKFLOW_STAGES.length}…`)
  await prisma.workflowStage.createMany({
    data: Array.from({ length: cooperationCount }, (_, index) =>
      WORKFLOW_STAGES.map((stage) => ({
        id: `vol-s-${index}-${stage.number}`,
        cooperationId: `vol-c-${index}`,
        stageNumber: stage.number,
        title: stage.title,
        phase: stage.phase,
        status: stage.number < 5 ? ('COMPLETED' as const) : ('NOT_STARTED' as const),
        // CHECK workflow_stages_completed_result_check: завершённый этап — с результатом.
        result: stage.number < 5 ? 'Нагрузочный результат' : null,
      })),
    ).flat(),
  })

  const counts = {
    вузов: await prisma.university.count(),
    программ: await prisma.educationalProgram.count(),
    связок: await prisma.cooperation.count(),
    этапов: await prisma.workflowStage.count(),
  }

  console.log('\nГотово за', ((Date.now() - startedAt) / 1000).toFixed(1), 'с')
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  ${name}: ${value}`)
  }

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Наполнение упало:', error)
  process.exitCode = 1
})
