import type { AssignmentPriority, AssignmentStatus } from './enums'

/**
 * Поручения сотрудникам (решение 207): `GET/POST /api/assignments`,
 * `PATCH /api/assignments/:id`.
 *
 * Руководитель или администратор даёт сотруднику конкретное дело — «Позвонить
 * в МТУСИ до пятницы» — по вузу, связке или без привязки. Сотрудник видит свои
 * в «Моих поручениях» и двигает статус одной кнопкой; руководитель — в «Команде».
 */

/**
 * Где срок поручения относительно сегодняшней московской даты. Считается на сервере
 * одним правилом (`assignments.rules.ts`) для списка, колокольчика и «Команды»:
 * `overdue` — срок раньше сегодня, `today`, `tomorrow`, `later` — позже завтра,
 * `done` — поручение сделано, срок больше не важен.
 */
export type AssignmentDueState = 'overdue' | 'today' | 'tomorrow' | 'later' | 'done'

export interface AssignmentPersonDto {
  id: string
  fullName: string
}

export interface AssignmentUniversityDto {
  id: string
  name: string
  shortName: string | null
}

export interface AssignmentCooperationDto {
  id: string
  programName: string
}

export interface AssignmentDto {
  id: string
  /** Что сделать — до 300 символов. */
  text: string
  priority: AssignmentPriority
  status: AssignmentStatus
  /** Срок — календарная дата `ГГГГ-ММ-ДД` (московская): «до пятницы» — весь день пятницы. */
  dueDate: string
  dueState: AssignmentDueState
  /** На сколько дней просрочено; только у `dueState: 'overdue'`, иначе `null`. */
  daysOverdue: number | null
  assignee: AssignmentPersonDto
  author: AssignmentPersonDto
  /** Вуз поручения; у поручения по связке — вуз связки. */
  university: AssignmentUniversityDto | null
  cooperation: AssignmentCooperationDto | null
  /** Когда отмечено «Сделано»; `null`, пока не сделано. */
  doneAt: string | null
  createdAt: string
  updatedAt: string
  isMock: boolean
  /** Текущий пользователь — автор: может менять текст, срок, важность, исполнителя. */
  canEdit: boolean
  /** Текущий пользователь — исполнитель или автор: может сменить статус. У эксперта — `false`. */
  canChangeStatus: boolean
}

/** Счётчик поручений на человека — столбец «Поручения» экрана «Команда». */
export interface AssignmentCountsDto {
  /** Открытые: «Новое» и «В работе». */
  open: number
  /** Из них просроченные — тем же правилом, что `dueState: 'overdue'`. */
  overdue: number
}
