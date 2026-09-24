import { conflict, invalidTransition, validationError } from '@/shared/http/errors'
import { daysBetween } from '@/shared/utils/date'
import { CONTROL_POINT_STAGES, CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'
import { DEADLINE_WARNING_DAYS } from '@/shared/config/analytics.config'
import type { StageStatus, UserRole } from '@/shared/contracts/enums'
import { STAGE_STATUS_LABELS } from '@/shared/contracts/labels'

/**
 * Таблица переходов (решение 3 в CLAUDE.md).
 * Любой переход, которого здесь нет, — ошибка INVALID_TRANSITION.
 */
export const ALLOWED_TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  // Переоткрытие завершённого этапа — только с комментарием.
  COMPLETED: ['IN_PROGRESS'],
  // Отменённый этап конечный: переоткрыть может только администратор.
  CANCELLED: ['IN_PROGRESS'],
}

/** Реэкспорт: словарь один на всю систему и живёт в контрактах, доступных фронту. */
export { STAGE_STATUS_LABELS as STATUS_LABELS } from '@/shared/contracts/labels'

export interface StageState {
  stageNumber: number
  status: StageStatus
  result: string | null
  requiredTasksTotal: number
  requiredTasksDone: number
}

export interface TransitionRequest {
  toStatus: StageStatus
  comment?: string | null
  result?: string | null
  blockingReason?: string | null
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export interface PriorStageState {
  stageNumber: number
  title: string
  status: StageStatus
}

/** Контрольная точка: этап, который нельзя пройти раньше предшествующих. */
export function isControlPoint(stageNumber: number): boolean {
  return CONTROL_POINT_STAGES.includes(stageNumber)
}

/**
 * Что мешает этапу `stageNumber` начаться, завершиться или получить отметку в чек-листе.
 *
 * Контрольная точка — шлагбаум: дальше неё не пускает, пока она не **завершена**.
 * Отменённая точка не пройдена: «договор не понадобился» не значит «договор подписан»,
 * иначе отмена этапа 6 одним комментарием открывала передачу лицензии.
 *
 * Сама контрольная точка ждёт ещё и все предыдущие этапы. Для них отменённый этап
 * закрыт наравне с завершённым: этап 5 необязательный, и его отмена — обычный ход дела.
 */
export function findBlockingStages(
  stageNumber: number,
  priorStages: readonly PriorStageState[],
): PriorStageState[] {
  const waitsForAll = isControlPoint(stageNumber)
  return priorStages
    .filter((stage) => stage.stageNumber < stageNumber)
    .filter((stage) =>
      isControlPoint(stage.stageNumber)
        ? stage.status !== 'COMPLETED'
        : waitsForAll && stage.status !== 'COMPLETED' && stage.status !== 'CANCELLED',
    )
    .sort((left, right) => left.stageNumber - right.stageNumber)
}

/**
 * Проверка контрольных точек для любого этапа.
 *
 * Применяется к началу работы и к завершению — это два утверждения о процессе,
 * и оба обязаны быть правдой. Отмена и блокировка не проверяются: они ничего
 * не утверждают о выполненной работе, а честно сообщают, что её не будет
 * или что она встала.
 */
export function assertControlPointReady(
  stageNumber: number,
  toStatus: StageStatus,
  priorStages: readonly PriorStageState[],
): void {
  if (toStatus !== 'IN_PROGRESS' && toStatus !== 'COMPLETED') return

  const blocking = findBlockingStages(stageNumber, priorStages)
  if (blocking.length === 0) return

  const forbidden = toStatus === 'COMPLETED' ? 'его нельзя завершить' : 'его нельзя начать'
  throw controlPointRefusal(stageNumber, forbidden, blocking)
}

/**
 * Контрольную точку нельзя отменить, если за ней уже идёт работа.
 *
 * Иначе этап 7 продолжал жить «в работе» после отмены подписания, а кабинет вуза
 * при этом писал «не закрыт этап 6»: система противоречила сама себе. Переоткрыть
 * точку можно (договор бывает нужно переподписать) — тогда этапы за ней не завершатся,
 * пока точка не завершена снова.
 */
export function assertControlPointCancellable(
  stageNumber: number,
  laterStages: readonly PriorStageState[],
): void {
  if (!isControlPoint(stageNumber)) return
  const started = laterStages
    .filter((stage) => stage.stageNumber > stageNumber && !isAutoManaged(stage.stageNumber))
    .filter((stage) => stage.status !== 'NOT_STARTED' && stage.status !== 'CANCELLED')
    .sort((left, right) => left.stageNumber - right.stageNumber)
  if (started.length === 0) return
  throw invalidTransition(
    `Этап ${stageNumber} — контрольная точка: его нельзя отменить, пока за ним идёт работа. ` +
      `Уже начаты: ${describeBlockingStages(started)}.`,
    {
      stageNumber,
      isControlPoint: true,
      blockingStages: started.map((stage) => ({
        stageNumber: stage.stageNumber,
        title: stage.title,
        status: stage.status,
      })),
    },
  )
}

/**
 * Пункт чек-листа не отмечается там, куда контрольная точка ещё не пускает.
 *
 * Начать этап 7 до подписания договора было нельзя, а отметить в его чек-листе
 * «Передана лицензия» — можно: и сотруднику, и представителю вуза в кабинете.
 * Отметка пункта — такое же утверждение о сделанной работе, как начало этапа.
 * Снять отметку можно всегда: это не утверждение, а отказ от него.
 */
export function assertChecklistReady(
  stageNumber: number,
  isDone: boolean,
  priorStages: readonly PriorStageState[],
): void {
  if (!isDone) return

  const blocking = findBlockingStages(stageNumber, priorStages)
  if (blocking.length === 0) return

  throw controlPointRefusal(stageNumber, 'его пункты нельзя отмечать', blocking)
}

/** Список незакрытых этапов для отказа: «6 «Подписание документов»». */
export function describeBlockingStages(blocking: readonly PriorStageState[]): string {
  return blocking.map((stage) => `${stage.stageNumber} «${stage.title}»`).join(', ')
}

/** `forbidden` — что именно нельзя: «его нельзя начать», «его пункты нельзя отмечать». */
function controlPointRefusal(
  stageNumber: number,
  forbidden: string,
  blocking: readonly PriorStageState[],
) {
  const message = isControlPoint(stageNumber)
    ? `Этап ${stageNumber} — контрольная точка: ${forbidden}, пока не закрыты предыдущие этапы. ` +
      `Не закрыты: ${describeBlockingStages(blocking)}.`
    : `Этап ${stageNumber} идёт после контрольной точки: ${forbidden}, пока она не завершена. ` +
      `Не завершены: ${describeBlockingStages(blocking)}.`
  return invalidTransition(message,
    {
      stageNumber,
      isControlPoint: isControlPoint(stageNumber),
      blockingStages: blocking.map((stage) => ({
        stageNumber: stage.stageNumber,
        title: stage.title,
        status: stage.status,
      })),
    },
  )
}

/** Этап 14 вычисляется автоматически и руками не меняется (решение 2). */
export function isAutoManaged(stageNumber: number): boolean {
  return stageNumber === CONTROL_STAGE_NUMBER
}

/**
 * Проверяет переход целиком: допустимость по таблице, условия завершения,
 * блокировки, отмены и переоткрытия. Бросает ошибку с понятным русским текстом.
 */
export function assertTransition(
  stage: StageState,
  request: TransitionRequest,
  role: UserRole,
): void {
  if (isAutoManaged(stage.stageNumber)) {
    throw invalidTransition(
      'Этап «Контроль выполнения всех этапов» вычисляется автоматически и вручную не изменяется',
      { stageNumber: stage.stageNumber },
    )
  }

  const from = stage.status
  const to = request.toStatus

  if (from === to) {
    throw invalidTransition(`Этап уже находится в статусе «${STAGE_STATUS_LABELS[to]}»`, {
      from,
      to,
    })
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw invalidTransition(
      `Недопустимый переход: «${STAGE_STATUS_LABELS[from]}» → «${STAGE_STATUS_LABELS[to]}»`,
      { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    )
  }

  // Переоткрытие отменённого этапа — право администратора.
  if (from === 'CANCELLED' && role !== 'ADMIN') {
    throw invalidTransition(
      'Отменённый этап может переоткрыть только администратор',
      { from, to },
    )
  }

  // Любое переоткрытие требует объяснения: оно попадёт в историю.
  if ((from === 'COMPLETED' || from === 'CANCELLED') && !isFilled(request.comment)) {
    throw validationError('Для переоткрытия этапа нужен комментарий с причиной', [
      { field: 'comment', message: 'Укажите причину переоткрытия' },
    ])
  }

  if (to === 'BLOCKED' && !isFilled(request.blockingReason)) {
    throw validationError('Для блокировки этапа нужна причина', [
      { field: 'blockingReason', message: 'Укажите причину блокировки' },
    ])
  }

  if (to === 'CANCELLED' && !isFilled(request.comment)) {
    throw validationError('Для отмены этапа нужен комментарий с основанием', [
      { field: 'comment', message: 'Укажите основание отмены, например «не требуется»' },
    ])
  }

  if (to === 'COMPLETED') {
    const result = isFilled(request.result) ? request.result : stage.result
    if (!isFilled(result)) {
      throw validationError('Нельзя завершить этап без результата', [
        { field: 'result', message: 'Опишите результат этапа' },
      ])
    }

    if (stage.requiredTasksDone < stage.requiredTasksTotal) {
      throw invalidTransition(
        `Не закрыты обязательные пункты чек-листа: ${stage.requiredTasksDone} из ${stage.requiredTasksTotal}`,
        {
          requiredTasksDone: stage.requiredTasksDone,
          requiredTasksTotal: stage.requiredTasksTotal,
        },
      )
    }
  }
}

/** Поля этапа, которые обязательны в его статусе (решение 4). */
export interface StageStatusFields {
  status: StageStatus
  result: string | null
  blockingReason: string | null
}

/**
 * Каким станет этап после записи.
 *
 * Правила перехода проверяли запрос, а записывался этап, собранный из запроса
 * и сохранённых полей. Между ними терялось главное: `{"status":"COMPLETED",
 * "result":"   "}` проходило проверку по сохранённому результату и записывало
 * пустой; `{"result":null}` у завершённого этапа не проверялось вовсе — правка
 * полей без смены статуса правил не касалась; `{"blockingReason":""}`
 * у заблокированного оставляло его без причины. Теперь итог собирается здесь
 * один раз, проверяется (`assertStageFieldsComplete`) и он же записывается.
 */
export function resolveStageFields(
  stage: StageStatusFields,
  input: { status?: StageStatus; result?: string | null; blockingReason?: string | null },
): StageStatusFields {
  const status = input.status ?? stage.status
  const statusChanged = status !== stage.status

  // Завершая этап, результат можно не присылать — берётся сохранённый
  // (контракт: «в теле или уже сохранённый»). Пустой в теле его не стирает.
  const result =
    statusChanged && status === 'COMPLETED'
      ? isFilled(input.result)
        ? (input.result as string)
        : stage.result
      : input.result !== undefined
        ? input.result
        : stage.result

  // Причина блокировки живёт, только пока этап заблокирован.
  const blockingReason =
    status !== 'BLOCKED'
      ? null
      : input.blockingReason !== undefined
        ? input.blockingReason
        : stage.blockingReason

  return { status, result, blockingReason }
}

/**
 * Текст записи истории при смене статуса.
 *
 * В историю шёл только комментарий запроса, а причина блокировки и результат
 * приходят своими полями — и записи «Заблокирован» и «Завершён» оставались
 * пустыми. Хуже того, причина блокировки на этапе стирается при снятии
 * блокировки (`resolveStageFields`), и после этого узнать, почему этап стоял,
 * было негде. Теперь запись несёт то, ради чего переход делался:
 * у блокировки — причину, у завершения — результат, у остальных — комментарий
 * (при снятии блокировки это «что изменилось», оно необязательное).
 * Комментарий, присланный вместе с причиной или результатом, не теряется.
 */
export function historyComment(
  toStatus: StageStatus,
  resulting: StageStatusFields,
  comment: string | null | undefined,
): string | null {
  const main =
    toStatus === 'BLOCKED'
      ? resulting.blockingReason
      : toStatus === 'COMPLETED'
        ? resulting.result
        : null
  const parts = [main, comment]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.length > 0 ? unique.join('\n') : null
}

/** Итоговое состояние этапа само удовлетворяет правилам своего статуса. */
export function assertStageFieldsComplete(fields: StageStatusFields): void {
  if (fields.status === 'COMPLETED' && !isFilled(fields.result)) {
    throw validationError('У завершённого этапа должен быть результат', [
      {
        field: 'result',
        message: 'Результат завершённого этапа не стирается. Чтобы изменить этап, переоткройте его',
      },
    ])
  }
  if (fields.status === 'BLOCKED' && !isFilled(fields.blockingReason)) {
    throw validationError('У заблокированного этапа должна быть причина', [
      { field: 'blockingReason', message: 'Укажите причину блокировки' },
    ])
  }
}

/**
 * Пункты чек-листа закрытого этапа не меняются.
 *
 * Иначе с завершённого этапа можно снять обязательный пункт, и он останется завершённым
 * с незакрытым обязательным пунктом — состояние, которого правила перехода не допускают.
 * Нужно поправить чек-лист закрытого этапа — этап сначала переоткрывают.
 */
/** Можно ли менять пункты чек-листа этапа — то же правило, что в assertTasksEditable. */
export function areTasksEditable(stageStatus: StageStatus, stageNumber: number): boolean {
  return !isAutoManaged(stageNumber) && stageStatus !== 'COMPLETED' && stageStatus !== 'CANCELLED'
}

export function assertTasksEditable(stageStatus: StageStatus, stageNumber: number): void {
  if (isAutoManaged(stageNumber)) {
    throw conflict('У контрольного этапа нет собственного чек-листа')
  }
  if (stageStatus === 'COMPLETED' || stageStatus === 'CANCELLED') {
    throw conflict(
      `Этап в статусе «${STAGE_STATUS_LABELS[stageStatus]}»: пункты чек-листа не меняются. ` +
        'Переоткройте этап, чтобы его править.',
      { stageStatus },
    )
  }
}

/**
 * Статус контрольного этапа 14 по состоянию этапов 1–13 (решение 2).
 * COMPLETED — когда все закрыты или отменены.
 */
export function computeControlStatus(others: readonly StageStatus[]): StageStatus {
  if (others.length === 0) return 'NOT_STARTED'
  const allClosed = others.every((status) => status === 'COMPLETED' || status === 'CANCELLED')
  if (allClosed) return 'COMPLETED'
  const anyStarted = others.some((status) => status !== 'NOT_STARTED')
  return anyStarted ? 'IN_PROGRESS' : 'NOT_STARTED'
}

/**
 * Текущий этап — первый по номеру, который не завершён и не отменён (решение 5).
 * Порядок этапов не жёсткий: часть из них идёт параллельно.
 */
export function findCurrentStage<T extends { stageNumber: number; status: StageStatus }>(
  stages: readonly T[],
): T | null {
  const open = stages
    .filter((stage) => stage.status !== 'COMPLETED' && stage.status !== 'CANCELLED')
    .filter((stage) => !isAutoManaged(stage.stageNumber))
    .sort((a, b) => a.stageNumber - b.stageNumber)
  return open[0] ?? null
}

/** Процент выполнения связки: закрытыми считаются и завершённые, и отменённые этапы. */
export function computeProgressPercent(statuses: readonly StageStatus[]): number {
  if (statuses.length === 0) return 0
  const closed = statuses.filter(
    (status) => status === 'COMPLETED' || status === 'CANCELLED',
  ).length
  return Math.round((closed / statuses.length) * 100)
}

/** Этап просрочен, если срок прошёл, а этап не закрыт и не отменён. */
export function isOverdue(
  deadline: Date | null,
  status: StageStatus,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false
  if (status === 'COMPLETED' || status === 'CANCELLED') return false
  return deadline.getTime() < now.getTime()
}

/**
 * Срок ещё не вышел, но выйдет со дня на день.
 *
 * Система создана, чтобы успевать, а не отчитываться о пропущенном: просрочка —
 * это уже случившаяся неприятность, а здесь остаётся время её предотвратить.
 * Порог — `DEADLINE_WARNING_DAYS`, помечен TEMP.
 *
 * Просроченный этап сюда не попадает: у него своя пометка, и показывать один
 * этап в двух состояниях значило бы считать его дважды.
 */
export function isDueSoon(
  deadline: Date | null,
  status: StageStatus,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false
  if (status === 'COMPLETED' || status === 'CANCELLED') return false

  if (deadline.getTime() < now.getTime()) return false
  // По календарю, как бейдж «через N дн.»: по часам два этапа «через 3 дн.»
  // получали разную пометку в зависимости от часа срока.
  return daysBetween(now, deadline) <= DEADLINE_WARNING_DAYS
}

