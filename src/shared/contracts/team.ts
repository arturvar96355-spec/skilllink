import type { AssignmentCountsDto } from './assignment'
import type { CooperationStatus, MeetingFormat, StageStatus, UserRole } from './enums'
import type { ChannelId } from './notify-channels'

/**
 * Экран «Команда» (решение 203): `GET /api/team` и `GET /api/team/:userId`.
 *
 * Все числа — той же базой подсчёта, что на главной и в личном кабинете:
 * «связки в работе» — статусы «Черновик» и «В работе» (как «Активные связки»),
 * «просрочено» — текущие начатые этапы после срока (как бейдж карточки связки,
 * `isOverdue`), «этапы в срок» — завершённые этапы со сроком без контрольного 14.
 */

/** Уровень нагрузки: до `normMax` — норма, до `highMax` — высокая, выше — перегружен. */
export type TeamLoadLevel = 'NORMAL' | 'HIGH' | 'OVERLOADED'

export const TEAM_LOAD_LEVEL_LABELS: Record<TeamLoadLevel, string> = {
  NORMAL: 'Норма',
  HIGH: 'Высокая',
  OVERLOADED: 'Перегружен',
}

/** Правило нагрузки — из конфига сервера, чтобы экран рисовал пороги без своей копии. */
export interface TeamLoadRuleDto {
  overdueWeight: number
  normMax: number
  highMax: number
  scaleMax: number
}

/** Нагрузка сотрудника и из чего она сложилась. */
export interface TeamLoadDto {
  points: number
  level: TeamLoadLevel
  cooperations: number
  /** Встречи впереди на неделе (`meetingsAhead`), а не все встречи недели. */
  meetings: number
  overdue: number
}

/** Этап со сроком — ближайший, просроченный или на этой неделе. */
export interface TeamStageRefDto {
  stageId: string
  stageNumber: number
  title: string
  status: StageStatus
  deadline: string
  cooperationId: string
  universityName: string
  universityShortName: string | null
  programName: string
  /** Сколько дней назад вышел срок; `0` — сегодня. Только у просроченных, иначе `null`. */
  daysOverdue: number | null
}

/**
 * Запись журнала для руководителя — только безопасные поля: что сделано словами,
 * над каким объектом (вид и вуз) и когда. Ни идентификаторов, ни `payload`, ни адреса
 * клиента: полный журнал по-прежнему открыт только администратору (`GET /api/audit`).
 */
export interface TeamActionDto {
  /** Код действия журнала — для подписи на фронте, если понадобится своя. */
  action: string
  /** Действие словами: «Изменён статус этапа». */
  label: string
  /** Вид объекта словами: «Этап связки», «Вуз». */
  objectLabel: string
  /** Краткое название вуза, если действие о вузе, связке, этапе, встрече или документе. */
  universityShortName: string | null
  at: string
}

export interface TeamMemberDto {
  id: string
  fullName: string
  position: string | null
  role: UserRole
  /** Может ли вести связки (роль ADMIN, MANAGER, HEAD) — кому можно передать связку. */
  canBeResponsible: boolean
  /** Связки в работе (черновик и в работе), где сотрудник ответственный. */
  activeCooperations: number
  /** Разных вузов среди этих связок. */
  universitiesCount: number
  /** Первые вузы по числу связок — краткие названия (не больше `TEAM_UNIVERSITIES_SHOWN`). */
  universities: string[]
  /** Ближайший ещё не наступивший срок его этапа; `null` — сроков впереди нет. */
  nearestDeadline: TeamStageRefDto | null
  /** Просроченные этапы, где он ответственный за этап. */
  overdueStages: number
  /** Встречи на этой московской неделе: ответственный или участник. */
  meetingsThisWeek: number
  /**
   * Из них ещё впереди: с текущего момента до конца московской недели. Только они идут
   * в нагрузку (`load.meetings`) — прошедшая встреча уже не работа (решение 203).
   */
  meetingsAhead: number
  /** Открытые задания по письмам вузов на нём. */
  openLetterTasks: number
  /** Поручения (решение 207): открытые и из них просроченные — то же правило, что в списке поручений. */
  assignments: AssignmentCountsDto
  /**
   * Куда уйдёт уведомление о новом поручении помимо колокольчика: мессенджер, который
   * сотрудник подключил и который настроен на сервере (основной — первым, как у `sendToUser`).
   * `null` — только в SkillLink. Окно «Дать поручение» пишет это под «Кому».
   */
  messenger: ChannelId | null
  /** Его этапы, закрытые в срок: `percent: null` — закрытых со сроком ещё нет. */
  onTime: { closedOnTime: number; closedWithDeadline: number; percent: number | null }
  /** Последняя запись журнала от его имени (без входов); `null` — записей нет. */
  lastAction: TeamActionDto | null
  /** Дней с последнего действия по московским суткам; `null` — действий не было. */
  daysSinceLastAction: number | null
  /** Без движения `staleDays` дней и больше (или действий не было вовсе). */
  isStale: boolean
  /** `null` — связки не ведёт: нагрузка по правилу не считается. */
  load: TeamLoadDto | null
}

export interface TeamAvailableDto {
  userId: string
  fullName: string
  points: number
  /** Запас до нормы в баллах. */
  capacity: number
}

export interface TeamSummaryDto {
  /** Средняя нагрузка тех, кто ведёт связки; `null` — никто не ведёт. */
  averageLoad: number | null
  averageLevel: TeamLoadLevel | null
  /** По скольким сотрудникам посчитано среднее. */
  loadMembers: number
  /** Этапы в срок по всей системе — то же число, что «Этапы, закрытые в срок» на главной. */
  stagesOnTime: { closedOnTime: number; closedWithDeadline: number; percent: number | null }
  /** Связки в работе всего — то же число, что «Активные связи» на главной. */
  activeCooperations: number
  /**
   * Из них ведут люди вне списка команды (учётная запись эксперта или заблокированный
   * сотрудник) — чтобы сумма по строкам сходилась с главной явно, а не «примерно».
   */
  activeCooperationsOutsideTeam: number
  /** Кто может взять связку: нагрузка в норме, по возрастанию баллов. */
  available: TeamAvailableDto[]
}

export interface TeamOverviewDto {
  members: TeamMemberDto[]
  summary: TeamSummaryDto
  /** Московская неделя: понедельник 00:00 — следующий понедельник 00:00 (не включая). */
  week: { from: string; to: string }
  loadRule: TeamLoadRuleDto
  staleDays: number
  containsMockData: boolean
  generatedAt: string
}

export interface TeamCooperationDto {
  id: string
  status: CooperationStatus
  universityId: string
  universityName: string
  universityShortName: string | null
  programName: string
  /** Текущий этап — первый не закрытый по номеру. */
  currentStage: { stageNumber: number; title: string; deadline: string | null; isOverdue: boolean } | null
  overdueStages: number
  isMock: boolean
}

export interface TeamMeetingDto {
  id: string
  date: string
  topic: string
  format: MeetingFormat
  universityShortName: string | null
  cooperationId: string | null
  /** Сотрудник ведёт встречу или приглашён участником. */
  role: 'RESPONSIBLE' | 'PARTICIPANT'
  /** Ещё впереди — идёт в нагрузку; `false` — уже прошла на этой неделе. */
  isAhead: boolean
}

export interface TeamMemberDetailDto {
  member: TeamMemberDto
  cooperations: TeamCooperationDto[]
  overdueStages: TeamStageRefDto[]
  weekStages: TeamStageRefDto[]
  weekMeetings: TeamMeetingDto[]
  recentActions: TeamActionDto[]
  week: { from: string; to: string }
  loadRule: TeamLoadRuleDto
  staleDays: number
  containsMockData: boolean
  generatedAt: string
}

/**
 * Страница сотрудника `GET /api/team/:userId/profile` (решение 230): то же, что панель,
 * тем же расчётом, плюс контакты. Кто видит «Команду» — любого сотрудника; остальные
 * сотрудники ИТ-Школы — только себя.
 */
export interface TeamMemberProfileDto extends TeamMemberDetailDto {
  contacts: {
    /**
     * Рабочая почта — тем же правилом, что в справочнике пользователей (ADMIN, HEAD,
     * MANAGER) и всегда своя; остальным — `null`. Телефона у учётной записи нет.
     */
    email: string | null
  }
  /** Страница открыта самим сотрудником. */
  isSelf: boolean
}
