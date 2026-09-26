/**
 * Данные для прогноза (решение 135): история связок для обучения и хранение
 * последней модели по каждой вехе. Математика и признаки — в чистых модулях
 * рядом (forecast-features.ts, forecast-model.ts) и данных не читают сами.
 */

import { prisma } from '@/shared/db/prisma'
import { Prisma } from '@/generated/prisma/client'
import { FORECAST } from '@/shared/config/forecast.config'
import type { CooperationStatus } from '@/shared/contracts/enums'
import type { ForecastModelStatus } from '@/shared/contracts/forecast'
import type { CooperationTimeline, PeerCooperation } from './forecast-features'
import { peersAt } from './forecast-features'
import type { TrainedForecastModel } from './forecast-model'
import type { StoredModel } from './forecast-explain'

/** Проекция, из которой строится `CooperationTimeline` — общая для обучения и одной связки. */
const TIMELINE_SELECT = {
  id: true,
  universityId: true,
  isMock: true,
  createdAt: true,
  firstContactAt: true,
  startedAt: true,
  closedAt: true,
  status: true,
  university: { select: { region: true } },
  program: { select: { level: true } },
  stages: {
    select: {
      stageNumber: true,
      history: { select: { toStatus: true, changedAt: true } },
      tasks: { select: { doneAt: true } },
    },
  },
  meetings: { select: { date: true } },
  documents: { select: { id: true, history: { select: { toStatus: true, changedAt: true } } } },
  recommendations: { select: { status: true, resolvedAt: true } },
} as const

type TimelineRow = NonNullable<Awaited<ReturnType<typeof loadOne>>>

async function loadOne(id: string) {
  return prisma.cooperation.findUnique({ where: { id }, select: TIMELINE_SELECT })
}

/**
 * Строка запроса → история связки. Дата начала — самая ранняя из первого контакта,
 * начала, создания записи и первого события истории этапов (свежие связки без
 * заполненных дат всё равно получают точку отсчёта).
 */
function toTimeline(row: TimelineRow): CooperationTimeline {
  const stageEvents = row.stages.flatMap((stage) =>
    stage.history.map((event) => ({ stageNumber: stage.stageNumber, toStatus: event.toStatus, at: event.changedAt })),
  )
  const tasks = row.stages.flatMap((stage) =>
    stage.tasks.map((task) => ({ stageNumber: stage.stageNumber, doneAt: task.doneAt })),
  )
  const documentEvents = row.documents.flatMap((document) =>
    document.history.map((event) => ({ documentId: document.id, toStatus: event.toStatus, at: event.changedAt })),
  )
  const dismissedRecommendations = row.recommendations
    .filter((item) => item.status === 'DISMISSED' && item.resolvedAt !== null)
    .map((item) => item.resolvedAt as Date)

  const candidates = [row.createdAt.getTime()]
  if (row.firstContactAt) candidates.push(row.firstContactAt.getTime())
  if (row.startedAt) candidates.push(row.startedAt.getTime())
  for (const event of stageEvents) candidates.push(event.at.getTime())

  return {
    id: row.id,
    universityId: row.universityId,
    region: row.university.region,
    programLevel: row.program.level,
    startedAt: new Date(Math.min(...candidates)),
    closedAt: row.closedAt,
    isMock: row.isMock,
    stageEvents,
    tasks,
    meetings: row.meetings.map((meeting) => meeting.date),
    documentEvents,
    dismissedRecommendations,
  }
}

/**
 * Вся история для обучения. Предел — предохранитель, а не постраничный список:
 * обучение читает данные разом (тяжёлый маршрут, group `heavy`), но не всю базу,
 * если связок вдруг окажется на порядки больше демонстрационного набора.
 */
export async function fetchTrainingTimelines(): Promise<CooperationTimeline[]> {
  const rows = await prisma.cooperation.findMany({
    select: TIMELINE_SELECT,
    orderBy: { id: 'asc' },
    take: FORECAST.maxTrainingCooperations,
  })
  return rows.map(toTimeline)
}

/**
 * Связка для прогноза вместе с соседями по вузу (для признака «других действующих
 * связок у вуза»). Два запроса: сама связка — чтобы узнать вуз и статус, затем все
 * связки того же вуза — из них строятся и полная история, и лёгкие соседи.
 */
export async function fetchCooperationWithPeers(
  id: string,
): Promise<{ timeline: CooperationTimeline; peers: PeerCooperation[]; status: CooperationStatus } | null> {
  const own = await loadOne(id)
  if (!own) return null

  const rows = await prisma.cooperation.findMany({
    where: { universityId: own.universityId },
    select: TIMELINE_SELECT,
  })
  const timelines = rows.map(toTimeline)
  const timeline = timelines.find((item) => item.id === id)
  if (!timeline) return null

  return { timeline, peers: peersAt(timelines, own.universityId), status: own.status }
}

const DB_STATUS: Record<ForecastModelStatus, 'PUBLISHED' | 'BASELINE_BETTER' | 'INSUFFICIENT_DATA'> = {
  published: 'PUBLISHED',
  baseline_better: 'BASELINE_BETTER',
  insufficient_data: 'INSUFFICIENT_DATA',
}
const APP_STATUS: Record<'PUBLISHED' | 'BASELINE_BETTER' | 'INSUFFICIENT_DATA', ForecastModelStatus> = {
  PUBLISHED: 'published',
  BASELINE_BETTER: 'baseline_better',
  INSUFFICIENT_DATA: 'insufficient_data',
}

function toStoredModel(row: {
  milestoneStage: number
  horizonDays: number
  version: number
  status: 'PUBLISHED' | 'BASELINE_BETTER' | 'INSUFFICIENT_DATA'
  trainedAt: Date
  metrics: unknown
  coefficients: unknown
  featureStats: unknown
}): StoredModel {
  return {
    milestoneStage: row.milestoneStage,
    horizonDays: row.horizonDays,
    version: row.version,
    trainedAt: row.trainedAt,
    status: APP_STATUS[row.status],
    metrics: row.metrics as StoredModel['metrics'],
    coefficients: row.coefficients as StoredModel['coefficients'],
    featureStats: row.featureStats as StoredModel['featureStats'],
  }
}

/** Последняя модель каждой вехи, для которой обучение уже проводилось. */
export async function fetchLatestModels(): Promise<Map<number, StoredModel>> {
  const rows = await prisma.forecastModel.findMany()
  return new Map(rows.map((row) => [row.milestoneStage, toStoredModel(row)]))
}

export async function fetchLatestModel(milestoneStage: number): Promise<StoredModel | null> {
  const row = await prisma.forecastModel.findUnique({ where: { milestoneStage } })
  return row ? toStoredModel(row) : null
}

/**
 * Сохраняет обучение вехи, заменяя предыдущую запись той же вехи (уникальность
 * по `milestoneStage`, «хранится последняя активная запись»). Версия растёт от
 * предыдущей записи этой же вехи, а не от общего числа строк в таблице.
 */
export async function saveTrainedModel(
  trained: TrainedForecastModel,
  trainedAt: Date,
): Promise<StoredModel> {
  const previous = await prisma.forecastModel.findUnique({
    where: { milestoneStage: trained.milestoneStage },
    select: { version: true },
  })
  const version = (previous?.version ?? 0) + 1
  const data = {
    milestoneStage: trained.milestoneStage,
    horizonDays: trained.horizonDays,
    version,
    status: DB_STATUS[trained.status],
    trainedAt,
    metrics: trained.metrics as unknown as Prisma.InputJsonValue,
    coefficients:
      trained.coefficients === null
        ? Prisma.JsonNull
        : (trained.coefficients as unknown as Prisma.InputJsonValue),
    featureStats: trained.featureStats as unknown as Prisma.InputJsonValue,
  }
  const row = await prisma.forecastModel.upsert({
    where: { milestoneStage: trained.milestoneStage },
    create: data,
    update: data,
  })
  return toStoredModel(row)
}
