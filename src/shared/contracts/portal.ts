import type { ApplicationStatus, CooperationStatus, DataOrigin, StageStatus } from './enums'

/** Заявка на обучение. Персональных данных обучающихся не содержит (решение 9). */
export interface ApplicationDto {
  id: string
  programId: string
  programName: string
  universityId: string
  status: ApplicationStatus
  source: DataOrigin
  /** Сколько заявок в одной записи: вуз может внести пакет разом. */
  quantity: number
  comment: string | null
  submittedAt: string
  createdAt: string
}

/** Материал, переданный вузу: его нужно подтвердить (задачи этапа 7). */
export interface PortalMaterialDto {
  taskId: string
  title: string
  cooperationId: string
  programName: string
  productName: string | null
  isConfirmed: boolean
  confirmedAt: string | null
  stageStatus: StageStatus
}

export interface PortalProgramDto {
  id: string
  name: string
  level: string
  /** Заявки считаются по поданным заявкам и вузом напрямую не вводятся. */
  applicationCount: number | null
  studentCount: number | null
  groupCount: number | null
  metricsUpdatedAt: string | null
}

export interface PortalCooperationDto {
  id: string
  programName: string
  productName: string | null
  status: CooperationStatus
  currentStageNumber: number | null
  currentStageTitle: string | null
  currentStageStatus: StageStatus | null
  progressPercent: number
  classesStartAt: string | null
}

/** Сводка кабинета представителя вуза. Аналитики и рейтингов здесь нет (решение 9). */
export interface PortalOverviewDto {
  universityId: string
  universityName: string
  programs: PortalProgramDto[]
  cooperations: PortalCooperationDto[]
  /** Сколько материалов ждут подтверждения получения. */
  pendingMaterials: number
  documentsCount: number
  generatedAt: string
}
