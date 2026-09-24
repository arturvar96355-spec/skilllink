import { notFound, validationError } from '@/shared/http/errors'
import { writeAudit } from '@/shared/audit/audit'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, universityScope } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ProductDto,
  ProductListItemDto,
  ProductReleasePreviewDto,
  ProductReleaseResultDto,
  ProductReleaseTargetDto,
} from '@/shared/contracts/product'
import { toIsoRequired } from '@/shared/utils/date'
import * as repo from './products.repo'
import { auditControlStageChange } from '@/modules/workflow/workflow.repo'
import type {
  CreateProductInput,
  ProductListQuery,
  ReleaseProductVersionInput,
  SetProductSkillsInput,
  UpdateProductInput,
} from './products.schema'
import {
  MATERIALS_UPDATE_STAGE_NUMBER,
  assertVersionChanged,
  assertVersionEditable,
  assertVersionFormat,
  duplicateNameConflict,
  releaseTaskTitle,
  reopenComment,
} from './products.rules'

function toListItem(row: repo.ProductListRow): ProductListItemDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    version: row.version,
    status: row.status,
    documentationUrl: row.documentationUrl,
    skillCount: row._count.skills,
    cooperationCount: row._count.cooperations,
    isMock: row.isMock,
    updatedAt: toIsoRequired(row.updatedAt),
  }
}

export async function list(
  user: CurrentUser,
  query: ProductListQuery,
): Promise<{ data: ProductListItemDto[]; meta: PageMeta }> {
  assertCan(user, 'READ')
  const { rows, total } = await repo.findMany(query, universityScope(user))
  return {
    data: rows.map(toListItem),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

function toDetail(row: repo.ProductDetailRow): ProductDto {
  return {
    ...toListItem(row),
    description: row.description,
    skills: row.skills.map((item) => ({
      skillId: item.skill.id,
      name: item.skill.name,
      category: item.skill.category,
      relevance: item.relevance,
    })),
    createdAt: toIsoRequired(row.createdAt),
  }
}

export async function getById(user: CurrentUser, id: string): Promise<ProductDto> {
  assertCan(user, 'READ')
  const row = await repo.findById(id, universityScope(user))
  if (!row) throw notFound('IT-продукт не найден')
  return toDetail(row)
}

/**
 * Заведение IT-продукта в реестр.
 *
 * Без него продукт существовал только в демо-наборе: у новой связки он навсегда
 * оставался «не выбран». Продукт, заведённый вручную, — не демонстрационный.
 */
export async function create(user: CurrentUser, input: CreateProductInput): Promise<ProductDto> {
  assertCan(user, 'WRITE')
  if (await repo.findByNameInsensitive(input.name)) throw duplicateNameConflict(input.name)

  const row = await repo.create({ ...input, isMock: false })
  await writeAudit({
    userId: user.id,
    action: 'product.create',
    objectType: 'ITProduct',
    objectId: row.id,
    payload: { fields: Object.keys(input) },
  })
  return toDetail(row)
}

export async function update(
  user: CurrentUser,
  id: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  assertCan(user, 'WRITE')
  // Изменение — операция сотрудника: сужение по вузу здесь не нужно.
  const existing = await repo.findById(id, {})
  if (!existing) throw notFound('IT-продукт не найден')

  if (input.name !== undefined && (await repo.findByNameInsensitive(input.name, id))) {
    throw duplicateNameConflict(input.name)
  }
  if (input.version !== undefined && input.version !== existing.version) {
    assertVersionEditable(existing.version, input.version, await repo.countOpenCooperations(id))
  }

  const row = await repo.update(id, input)
  await writeAudit({
    userId: user.id,
    action: 'product.update',
    objectType: 'ITProduct',
    objectId: id,
    payload: { fields: Object.keys(input) },
  })
  return toDetail(row)
}

/** Полная замена набора навыков продукта — по тем же правилам, что у программ. */
export async function setSkills(
  user: CurrentUser,
  id: string,
  input: SetProductSkillsInput,
): Promise<ProductDto> {
  assertCan(user, 'WRITE')
  const existing = await repo.findById(id, {})
  if (!existing) throw notFound('IT-продукт не найден')

  const ids = input.skills.map((skill) => skill.skillId)
  const duplicates = ids.filter((value, index) => ids.indexOf(value) !== index)
  if (duplicates.length > 0) {
    throw validationError('Навык указан несколько раз', [
      { field: 'skills', message: `Повторяются: ${[...new Set(duplicates)].join(', ')}` },
    ])
  }

  const found = new Set(await repo.findExistingSkillIds(ids))
  const missing = ids.filter((skillId) => !found.has(skillId))
  if (missing.length > 0) {
    throw validationError('Указаны несуществующие навыки', [
      { field: 'skills', message: `Не найдены: ${missing.join(', ')}` },
    ])
  }

  await repo.replaceSkills(id, input.skills)
  await writeAudit({
    userId: user.id,
    action: 'product.skills.replace',
    objectType: 'ITProduct',
    objectId: id,
    payload: { skills: ids.length },
  })
  const row = await repo.findById(id, {})
  if (!row) throw notFound('IT-продукт не найден')
  return toDetail(row)
}

/**
 * Что изменится при выпуске новой версии продукта.
 *
 * Групповая операция затрагивает сразу много связок, поэтому у неё есть предпросмотр:
 * менеджер видит список до того, как нажмёт кнопку.
 */
async function buildReleasePlan(
  productId: string,
  version: string,
): Promise<{
  preview: ProductReleasePreviewDto
  apply: Array<{ stageId: string; cooperationId: string; reopen: boolean; nextSortOrder: number }>
  productName: string
}> {
  // Выпуск версии — операция сотрудника по всем связкам продукта: счёт без сужения.
  const product = await repo.findById(productId, {})
  if (!product) throw notFound('IT-продукт не найден')

  assertVersionFormat(version)

  const rows = await repo.findReleaseTargets(productId, MATERIALS_UPDATE_STAGE_NUMBER)
  const targets: ProductReleaseTargetDto[] = []
  const apply: Array<{
    stageId: string
    cooperationId: string
    reopen: boolean
    nextSortOrder: number
  }> = []

  for (const row of rows) {
    const stage = row.stages[0]
    if (!stage) continue

    // Отменённый этап означает «не требуется». Переоткрыть его может только
    // администратор поштучно — групповая операция такого решения не принимает.
    if (stage.status === 'CANCELLED') {
      targets.push({
        cooperationId: row.id,
        universityName: row.university.name,
        programName: row.program.name,
        stageNumber: stage.stageNumber,
        stageStatus: stage.status,
        effect: 'skipped-cancelled',
        reason: 'Этап отменён как не требующийся — групповая операция его не трогает',
      })
      continue
    }

    const reopen = stage.status === 'COMPLETED'
    const nextSortOrder =
      stage.tasks.reduce((max, task) => Math.max(max, task.sortOrder), -1) + 1

    targets.push({
      cooperationId: row.id,
      universityName: row.university.name,
      programName: row.program.name,
      stageNumber: stage.stageNumber,
      stageStatus: stage.status,
      effect: reopen ? 'stage-reopened' : 'task-added',
      reason: reopen
        ? 'Этап был закрыт: переданная версия устарела, этап откроется заново'
        : 'Этап в работе: добавится обязательный пункт о передаче новой версии',
    })
    apply.push({ stageId: stage.id, cooperationId: row.id, reopen, nextSortOrder })
  }

  return {
    preview: {
      productId,
      productName: product.name,
      currentVersion: product.version,
      nextVersion: version,
      targets,
      affectedCooperations: apply.length,
      reopenedStages: apply.filter((item) => item.reopen).length,
      skipped: targets.length - apply.length,
    },
    apply,
    productName: product.name,
  }
}

export async function previewRelease(
  user: CurrentUser,
  productId: string,
  version: string,
): Promise<ProductReleasePreviewDto> {
  assertCan(user, 'WRITE')
  const { preview } = await buildReleasePlan(productId, version)
  return preview
}

/**
 * Выпуск новой версии продукта (групповая операция из концепции).
 * Одно действие ставит задачи во всех связках, где передана устаревшая версия.
 */
export async function releaseVersion(
  user: CurrentUser,
  productId: string,
  input: ReleaseProductVersionInput,
): Promise<ProductReleaseResultDto> {
  assertCan(user, 'WRITE')

  const { preview, apply, productName } = await buildReleasePlan(productId, input.version)
  assertVersionChanged(preview.currentVersion, input.version)

  const comment = input.comment
    ? `${reopenComment(productName, input.version)}. ${input.comment}`
    : reopenComment(productName, input.version)

  const controlChanges = await repo.applyRelease({
    productId,
    version: input.version,
    taskTitle: releaseTaskTitle(productName, input.version),
    reopenComment: comment,
    userId: user.id,
    targets: apply,
  })
  for (const change of controlChanges) await auditControlStageChange(change, user.id)

  await writeAudit({
    userId: user.id,
    action: 'product.version.release',
    objectType: 'ITProduct',
    objectId: productId,
    payload: {
      version: input.version,
      affectedCooperations: preview.affectedCooperations,
      reopenedStages: preview.reopenedStages,
      skipped: preview.skipped,
    },
  })

  return { ...preview, appliedAt: new Date().toISOString() }
}
