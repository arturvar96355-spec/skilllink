import { notFound, validationError } from '@/shared/http/errors'
import { pageMeta } from '@/shared/http/pagination'
import { assertCan, isUniversityVisible } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  ApplicationDto,
  PortalCooperationDto,
  PortalMaterialDto,
  PortalOverviewDto,
  PortalProgramDto,
} from '@/shared/contracts/portal'
import { toIso, toIsoRequired } from '@/shared/utils/date'
import {
  computeProgressPercent,
  findCurrentStage,
  isAutoManaged,
} from '@/modules/workflow/workflow.rules'
import { assertCooperationOpen } from '@/modules/cooperation/cooperation.rules'
import { assertChecklistMarkable, checklistBlockers } from '@/modules/workflow/workflow.service'
import { describeBlockingStages } from '@/modules/workflow/workflow.rules'
import * as repo from './portal.repo'
import { MATERIALS_STAGE_NUMBER, assertMaterialsTask, resolvePortalUniversityId } from './portal.rules'
import type {
  ApplicationListQuery,
  ConfirmMaterialInput,
  SubmitApplicationInput,
  UpdateProgramMetricsInput,
} from './portal.schema'

/**
 * Общий вход в кабинет: определяет вуз и проверяет, что он виден пользователю.
 * Чужой вуз для представителя — NOT_FOUND, а не FORBIDDEN (решение 9).
 */
async function resolveUniversity(
  user: CurrentUser,
  requested: string | undefined,
): Promise<{ id: string; name: string }> {
  assertCan(user, 'UNIVERSITY_PORTAL')

  const universityId = resolvePortalUniversityId(user, requested)
  if (!isUniversityVisible(user, universityId)) throw notFound('Вуз не найден')

  const university = await repo.findUniversity(universityId)
  if (!university) throw notFound('Вуз не найден')

  return { id: university.id, name: university.name }
}

function toProgramDto(row: Awaited<ReturnType<typeof repo.findPrograms>>[number]): PortalProgramDto {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    applicationCount: row.applicationCount,
    studentCount: row.studentCount,
    groupCount: row.groupCount,
    metricsUpdatedAt: toIso(row.metricsUpdatedAt),
  }
}

function toCooperationDto(
  row: Awaited<ReturnType<typeof repo.findCooperations>>[number],
): PortalCooperationDto {
  const current = findCurrentStage(row.stages)
  const countable = row.stages.filter((stage) => !isAutoManaged(stage.stageNumber))

  return {
    id: row.id,
    programName: row.program.name,
    productName: row.product?.name ?? null,
    status: row.status,
    currentStageNumber: current?.stageNumber ?? null,
    currentStageTitle: current?.title ?? null,
    currentStageStatus: current?.status ?? null,
    progressPercent: computeProgressPercent(countable.map((stage) => stage.status)),
    classesStartAt: toIso(row.classesStartAt),
  }
}

type MaterialRow = Awaited<ReturnType<typeof repo.findMaterials>>[number]

/**
 * Почему материалы каждой связки пока нельзя подтверждать.
 *
 * Этап 7 — контрольная точка: пока договор не подписан, материалы не переданы.
 * Раньше кабинет всё равно показывал их «к подтверждению» и принимал
 * подтверждение — у связки, где этап 7 начать нельзя, появлялась отметка
 * «Передана лицензия».
 */
async function materialLocks(rows: readonly MaterialRow[]): Promise<Map<string, string | null>> {
  const cooperationIds = [...new Set(rows.filter((row) => !row.isDone).map((row) => row.stage.cooperationId))]
  const locks = await Promise.all(
    cooperationIds.map(async (cooperationId) => {
      const blocking = await checklistBlockers({ cooperationId, stageNumber: MATERIALS_STAGE_NUMBER })
      const reason =
        blocking.length === 0
          ? null
          : `${blocking.length === 1 ? 'Не закрыт этап' : 'Не закрыты этапы'} ` +
            describeBlockingStages(blocking)
      return [cooperationId, reason] as const
    }),
  )
  return new Map(locks)
}

function lockedReasonOf(row: MaterialRow, locks: Map<string, string | null>): string | null {
  if (row.isDone) return null
  return locks.get(row.stage.cooperationId) ?? null
}

export async function overview(
  user: CurrentUser,
  universityId: string | undefined,
): Promise<PortalOverviewDto> {
  const university = await resolveUniversity(user, universityId)

  const [programs, cooperations, materials, documentsCount] = await Promise.all([
    repo.findPrograms(university.id),
    repo.findCooperations(university.id),
    repo.findMaterials(university.id),
    repo.countDocuments(university.id),
  ])
  const locks = await materialLocks(materials)

  return {
    universityId: university.id,
    universityName: university.name,
    programs: programs.map(toProgramDto),
    cooperations: cooperations.map(toCooperationDto),
    // Ждут подтверждения только переданные материалы: те, что ещё не переданы,
    // вузу подтверждать нечего.
    pendingMaterials: materials.filter(
      (task) => !task.isDone && lockedReasonOf(task, locks) === null,
    ).length,
    documentsCount,
    generatedAt: new Date().toISOString(),
  }
}

export async function materials(
  user: CurrentUser,
  universityId: string | undefined,
): Promise<PortalMaterialDto[]> {
  const university = await resolveUniversity(user, universityId)
  const rows = await repo.findMaterials(university.id)
  const locks = await materialLocks(rows)

  return rows.map((row) => ({
    taskId: row.id,
    title: row.title,
    cooperationId: row.stage.cooperationId,
    programName: row.stage.cooperation.program.name,
    productName: row.stage.cooperation.product?.name ?? null,
    isConfirmed: row.isDone,
    confirmedAt: toIso(row.doneAt),
    stageStatus: row.stage.status,
    canConfirm: !row.isDone && lockedReasonOf(row, locks) === null,
    lockedReason: lockedReasonOf(row, locks),
  }))
}

/** Подтверждение получения материалов вузом (задачи этапа 7). */
export async function confirmMaterial(
  user: CurrentUser,
  taskId: string,
  universityId: string | undefined,
  input: ConfirmMaterialInput,
): Promise<PortalMaterialDto[]> {
  const university = await resolveUniversity(user, universityId)

  const task = await repo.findMaterialTask(taskId, university.id)
  if (!task) throw notFound('Задача не найдена')
  assertMaterialsTask(task.stage.stageNumber)

  // Те же правила, что и на пути сотрудника ИТ-Школы (workflow.service.toggleTask).
  // Без них представитель вуза менял состояние закрытой связки, когда сотруднику
  // это уже запрещено, — и отменить изменение было некому.
  assertCooperationOpen(task.stage.cooperation.status)

  if (!task.isDone) {
    // То же правило, что у сотрудника: пункт контрольной точки не отмечается,
    // пока не закрыты предыдущие этапы.
    await assertChecklistMarkable(task.stage, true)
    await repo.confirmMaterial(taskId, user.id)
  }

  await writeAudit({
    userId: user.id,
    action: 'portal.material.confirm',
    objectType: 'Task',
    objectId: taskId,
    payload: { universityId: university.id, comment: input.comment ?? null },
  })

  return materials(user, universityId)
}

/**
 * Вуз вносит численность обучающихся и количество групп.
 * Заявки сюда не входят: они считаются по поданным заявкам.
 */
export async function updateProgramMetrics(
  user: CurrentUser,
  programId: string,
  universityId: string | undefined,
  input: UpdateProgramMetricsInput,
): Promise<PortalProgramDto> {
  const university = await resolveUniversity(user, universityId)

  const program = await repo.findProgram(programId, university.id)
  if (!program) throw notFound('Образовательная программа не найдена')

  await repo.updateProgramMetrics(programId, {
    ...(input.studentCount !== undefined ? { studentCount: input.studentCount } : {}),
    ...(input.groupCount !== undefined ? { groupCount: input.groupCount } : {}),
  })

  await writeAudit({
    userId: user.id,
    action: 'portal.metrics.update',
    objectType: 'EducationalProgram',
    objectId: programId,
    payload: { fields: Object.keys(input) },
  })

  const programs = await repo.findPrograms(university.id)
  const updated = programs.find((row) => row.id === programId)
  if (!updated) throw notFound('Образовательная программа не найдена')
  return toProgramDto(updated)
}

function toApplicationDto(
  row: Awaited<ReturnType<typeof repo.findApplications>>['rows'][number],
): ApplicationDto {
  return {
    id: row.id,
    programId: row.programId,
    programName: row.program.name,
    universityId: row.universityId,
    status: row.status,
    source: row.source,
    quantity: row.quantity,
    comment: row.comment,
    submittedAt: toIsoRequired(row.submittedAt),
    createdAt: toIsoRequired(row.createdAt),
  }
}

/** Подача заявки на обучение. Персональных данных обучающихся не принимает. */
export async function submitApplication(
  user: CurrentUser,
  universityId: string | undefined,
  input: SubmitApplicationInput,
): Promise<ApplicationDto> {
  const university = await resolveUniversity(user, universityId)

  const program = await repo.findProgram(input.programId, university.id)
  if (!program) {
    throw validationError('Программа не найдена или относится к другому вузу', [
      { field: 'programId', message: 'Выберите программу своего вуза' },
    ])
  }

  const created = await repo.createApplication({
    program: { connect: { id: input.programId } },
    university: { connect: { id: university.id } },
    quantity: input.quantity,
    comment: input.comment ?? null,
    externalRef: input.externalRef ?? null,
    source: 'MANUAL',
    createdBy: { connect: { id: user.id } },
  })

  // Показатель заявок считается по самим заявкам, а не вводится руками (решение 9).
  const total = await repo.recalcApplicationCount(input.programId)

  await writeAudit({
    userId: user.id,
    action: 'application.create',
    objectType: 'Application',
    objectId: created.id,
    payload: { programId: input.programId, quantity: input.quantity, applicationCount: total },
  })

  const { rows } = await repo.findApplications(university.id, {
    page: 1,
    pageSize: 1,
    programId: input.programId,
  })
  const row = rows.find((item) => item.id === created.id) ?? rows[0]
  if (!row) throw notFound('Заявка не найдена')
  return toApplicationDto(row)
}

export async function listApplications(
  user: CurrentUser,
  universityId: string | undefined,
  query: ApplicationListQuery,
): Promise<{ data: ApplicationDto[]; meta: PageMeta }> {
  const university = await resolveUniversity(user, universityId)
  const { rows, total } = await repo.findApplications(university.id, query)
  return {
    data: rows.map(toApplicationDto),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}
