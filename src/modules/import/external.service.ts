import { prisma } from '@/shared/db/prisma'
import { validationError } from '@/shared/http/errors'
import { writeAudit } from '@/shared/audit/audit'
import { buildStages } from '@/modules/cooperation/cooperation.rules'
import * as cooperationRepo from '@/modules/cooperation/cooperation.repo'
import * as repo from './external.repo'
import type { ExternalImportInput } from './external.schema'

/**
 * Приём данных извне — сайт и LMS (решение 145, ТЗ функц. требования п.5).
 *
 * Идемпотентно по паре (source, externalId) — `ExternalImportLink`: повторный
 * запрос с теми же значениями находит ту же связку и обновляет в ней то, что
 * могло измениться (ответственный, продукт), вместо создания дубля.
 *
 * Реальный контракт с внешней стороной не согласован (сказано в самом ТЗ) —
 * поэтому вуз, программа и продукт заводятся по минимуму полей, которые контракт
 * действительно даёт, остальное — плейсхолдер (docs/API_CONTRACT.md).
 */

export type EntityOutcome = 'created' | 'matched'

export interface ExternalImportResult {
  source: string
  externalId: string
  university: { id: string; outcome: EntityOutcome }
  program: { id: string; outcome: EntityOutcome }
  product: { id: string; outcome: EntityOutcome }
  cooperation: { id: string; outcome: EntityOutcome | 'updated' }
}

async function resolveUniversity(
  input: ExternalImportInput['university'],
): Promise<{ id: string; outcome: EntityOutcome }> {
  const byInn = input.inn ? await repo.findUniversityByInn(input.inn) : null
  const existing = byInn ?? (await repo.findUniversityByName(input.name))
  if (existing) {
    if (existing.archivedAt) {
      throw validationError('Вуз в архиве', [
        { field: 'university.name', message: 'Найденный по названию/ИНН вуз в архиве — восстановите его, чтобы заводить связки' },
      ])
    }
    return { id: existing.id, outcome: 'matched' }
  }
  const created = await repo.createUniversity({
    name: input.name,
    inn: input.inn ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
  })
  return { id: created.id, outcome: 'created' }
}

async function resolveProgram(
  universityId: string,
  input: ExternalImportInput['program'],
): Promise<{ id: string; outcome: EntityOutcome }> {
  const existing = input.code
    ? await repo.findProgramByCode(universityId, input.code)
    : await repo.findProgramByName(universityId, input.name)
  if (existing) return { id: existing.id, outcome: 'matched' }
  const created = await repo.createProgram({ universityId, name: input.name, code: input.code ?? null })
  return { id: created.id, outcome: 'created' }
}

async function resolveProduct(name: string): Promise<{ id: string; outcome: EntityOutcome }> {
  const existing = await repo.findProductByName(name)
  if (existing) return { id: existing.id, outcome: 'matched' }
  const created = await repo.createProduct(name)
  return { id: created.id, outcome: 'created' }
}

export async function importExternal(input: ExternalImportInput): Promise<ExternalImportResult> {
  const responsible = await repo.findResponsibleByEmails(input.responsibleEmails)
  if (!responsible) {
    throw validationError('Не удалось определить ответственного', [
      {
        field: 'responsibleEmails',
        message: 'Ни одна из почт не совпала с действующим сотрудником (ADMIN или MANAGER)',
      },
    ])
  }

  const university = await resolveUniversity(input.university)
  const program = await resolveProgram(university.id, input.program)
  const product = await resolveProduct(input.product.name)

  const existingLink = await repo.findLink(input.source, input.externalId)

  let cooperationId: string
  let cooperationOutcome: EntityOutcome | 'updated'

  if (existingLink) {
    await repo.updateCooperationLink(existingLink.cooperationId, {
      productId: product.id,
      responsibleId: responsible.id,
    })
    cooperationId = existingLink.cooperationId
    cooperationOutcome = 'updated'
  } else {
    const startedAt = new Date()
    cooperationId = await prisma.$transaction(async (tx) => {
      await cooperationRepo.lockProgram(tx, program.id)
      const duplicate = await cooperationRepo.findOpenDuplicate(tx, {
        universityId: university.id,
        programId: program.id,
        productId: product.id,
      })
      if (duplicate) return duplicate.id

      return cooperationRepo.createWithStages(
        tx,
        {
          university: { connect: { id: university.id } },
          program: { connect: { id: program.id } },
          product: { connect: { id: product.id } },
          responsible: { connect: { id: responsible.id } },
          status: 'DRAFT',
          startedAt,
        },
        buildStages(startedAt, responsible.id),
      )
    })
    await repo.createLink(input.source, input.externalId, cooperationId)
    cooperationOutcome = 'created'
  }

  await writeAudit({
    userId: responsible.id,
    action: 'import.external',
    objectType: 'Cooperation',
    objectId: cooperationId,
    payload: {
      source: input.source,
      externalId: input.externalId,
      university: university.outcome,
      program: program.outcome,
      product: product.outcome,
      cooperation: cooperationOutcome,
    },
  })

  return {
    source: input.source,
    externalId: input.externalId,
    university,
    program,
    product,
    cooperation: { id: cooperationId, outcome: cooperationOutcome },
  }
}
