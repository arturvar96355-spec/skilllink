/**
 * Отчёт «Качество справочника» и топ кандидатов в дубли — для показа и слайда
 * (решение 134). Печатает то же, что отдаёт API, только текстом в терминал.
 *
 *   npm run dq:report
 *
 * Только чтение — ничего не меняет и не ставит пометок «не дубль».
 */
import 'dotenv/config'
import { prisma } from '@/shared/db/prisma'
import type { CurrentUser } from '@/shared/auth/current-user'
import { DUPLICATES } from '@/shared/config/data-quality.config'
import { DUPLICATE_ENTITY_TYPES, type DuplicateEntityType } from '@/shared/contracts/data-quality'
import * as service from '@/modules/data-quality/data-quality.service'
import { ENTITY_TITLES } from '@/modules/data-quality/quality.rules'

const TOP_PER_ENTITY = 5

/** Права на отчёт и дубли проверяют роль пользователя, а не саму учётную запись — этого достаточно. */
const REPORTER: CurrentUser = { id: 'dq-report', email: 'dq-report@skilllink.demo', fullName: 'Отчёт качества', role: 'ADMIN', universityId: null }

const GREY = '\x1b[90m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

const ENTITY_LABEL: Record<DuplicateEntityType, string> = {
  university: 'Вузы',
  skill: 'Навыки',
  program: 'Программы',
  product: 'IT-продукты',
}

function scoreColor(score: number | null): string {
  if (score === null) return GREY
  if (score >= 80) return '\x1b[32m'
  if (score >= 50) return YELLOW
  return '\x1b[31m'
}

async function main(): Promise<void> {
  console.log(`${BOLD}Качество справочника SkillLink${RESET}${GREY} (решение 134)${RESET}\n`)

  const report = await service.report(REPORTER)
  const overall = report.score === null ? 'нет данных' : `${report.score} / 100`
  console.log(`${BOLD}Итоговая оценка: ${scoreColor(report.score)}${overall}${RESET}`)
  if (report.isMock) console.log(`${GREY}В расчёте есть демонстрационные записи.${RESET}`)
  console.log('')

  for (const entity of report.entities) {
    const score = entity.score === null ? `${GREY}нет записей${RESET}` : `${scoreColor(entity.score)}${entity.score} / 100${RESET}`
    console.log(`${BOLD}${entity.title}${RESET} (${entity.total}): ${score}`)
    for (const issue of entity.issues) {
      if (issue.count === 0) continue
      console.log(
        `  ${GREY}·${RESET} ${issue.title}: ${issue.count} (${Math.round(issue.share * 100)}%), −${issue.penalty} балла`,
      )
      for (const item of issue.items.slice(0, 3)) console.log(`      ${GREY}${item.name}${RESET}`)
      if (issue.items.length > 3) console.log(`      ${GREY}… и ещё ${issue.count - 3}${RESET}`)
    }
    console.log('')
  }

  console.log(`${GREY}${report.explanation}${RESET}\n`)

  console.log(`${BOLD}Кандидаты в дубли — топ ${TOP_PER_ENTITY} по каждой сущности${RESET}`)
  for (const entity of DUPLICATE_ENTITY_TYPES) {
    const { data, meta } = await service.findDuplicates(REPORTER, {
      entity,
      threshold: DUPLICATES.trigramThreshold,
      includeDismissed: false,
      includeArchived: false,
    })
    console.log(`\n${BOLD}${ENTITY_LABEL[entity]}${RESET}${GREY} — сравнено ${meta.compared}, найдено пар ${meta.total} (${meta.candidateSource})${RESET}`)
    if (data.length === 0) {
      console.log(`  ${GREY}пар выше порога ${meta.threshold} не найдено${RESET}`)
      continue
    }
    for (const pair of data.slice(0, TOP_PER_ENTITY)) {
      console.log(`  ${scoreColor(pair.score * 100)}${pair.score}${RESET}  «${pair.a.name}» ↔ «${pair.b.name}»  ${GREY}[${pair.method}]${RESET}`)
      console.log(`        ${GREY}${pair.reasons.join('; ')}${RESET}`)
    }
  }

  console.log(`\n${GREY}Итого сущностей — ${ENTITY_TITLES.university}, ${ENTITY_TITLES.program}, ${ENTITY_TITLES.skill}, ` +
    `${ENTITY_TITLES.product}, ${ENTITY_TITLES.cooperation}. Порог триграмм по умолчанию — ${DUPLICATES.trigramThreshold}.${RESET}`)
}

main()
  .catch((error) => {
    console.error('Отчёт не построен:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
