import type {
  InboundLetterAnalyzedBy,
  InboundLetterGroup,
  InboundLetterSource,
  InboundLetterStatus,
  InboundLetterTaskStatus,
  InboundLetterVerdict,
} from './enums'
import type { AiDraftSource, AiFallbackReason } from './ai-assist'

/**
 * Письма вузов как обращения (решение 170, вариант 2 ТЗ «Письма вузов»).
 *
 * Живого почтового ящика нет — письмо приходит через демо-набор или загрузку `.eml`
 * (`POST /api/inbound-letters/upload`). Код и, если подключена модель, YandexGPT
 * определяют вуз/связку/этап и группу; ADMIN или HEAD подтверждают («Верно») или
 * исправляют («Неверно») разбор — решение создаёт задание ответственному за вуз
 * и одновременно размеченный пример, на котором учится разбор следующих писем.
 * Ответ вузу — только черновик (`replyDraft`): отправки нет.
 */

/** Цитата-основание из текста письма — короткий фрагмент, на который опирается разбор. */
export type InboundLetterQuote = string

/** Что нашёл разбор письма — код (и модель или правила), либо действующая версия после проверки. */
export interface InboundLetterAnalysisDto {
  universityId: string | null
  universityName: string | null
  cooperationId: string | null
  stageNumber: number | null
  group: InboundLetterGroup | null
  /** Предлагаемое действие ответственному — короткая фраза. */
  action: string | null
  /** Уверенность разбора 0..1. null — письмо ещё не разобрано. */
  confidence: number | null
  quotes: InboundLetterQuote[]
  analyzedBy: InboundLetterAnalyzedBy | null
  /** Почему разбор ушёл на правила, а не на модель; null — разбор моделью или письмо не разобрано. */
  fallbackReason: AiFallbackReason | null
  analyzedAt: string | null
}

/** Итог проверки сотрудником — заполнен начиная со статусов CONFIRMED/CORRECTED/DISMISSED. */
export interface InboundLetterReviewDto {
  reviewedById: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  verdict: InboundLetterVerdict | null
  comment: string | null
}

/** Черновик ответа вузу — только черновик, отправки нет: живого ящика нет вовсе. */
export interface InboundLetterReplyDraftDto {
  text: string
  source: AiDraftSource
  updatedAt: string
  /**
   * Ссылка `mailto:` с темой «Re: …» и текстом черновика — кнопка «Открыть в почте».
   * Обрезана по ограничению длины `mailto:`, если черновик длинный (см. описание маршрута).
   */
  mailto: string
}

/** Короткая сводка задания, которое создала проверка письма (одно на письмо). */
export interface InboundLetterTaskDto {
  id: string
  responsibleId: string | null
  responsibleName: string | null
  status: InboundLetterTaskStatus
  title: string
  createdAt: string
}

export interface InboundLetterDto {
  id: string
  senderEmail: string
  senderName: string | null
  subject: string
  bodyText: string
  receivedAt: string
  source: InboundLetterSource
  messageId: string | null
  status: InboundLetterStatus

  /** Действующий разбор: до «Неверно» совпадает с `detected`, после — то, что указал сотрудник. */
  current: InboundLetterAnalysisDto
  /** Снимок того, что нашёл разбор, — не переписывается решением «Неверно». */
  detected: InboundLetterAnalysisDto

  review: InboundLetterReviewDto | null
  task: InboundLetterTaskDto | null
  replyDraft: InboundLetterReplyDraftDto | null

  isMock: boolean
  createdAt: string
  updatedAt: string
}

/** Строка списка — без полного текста письма, как у соседних реестров. */
export type InboundLetterListItemDto = Omit<InboundLetterDto, 'bodyText' | 'replyDraft'> & {
  /** Начало текста письма — превью в таблице. */
  bodyPreview: string
}

/** Точность разбора по одной группе (решение 170, забывание — как решение 119). */
export interface InboundLetterGroupStatsDto {
  group: InboundLetterGroup
  /** «Верно N из M последних» — счётчики за всё время, без забывания. */
  totalReviewed: number
  totalCorrect: number
  /** Доля с забыванием (полупериод 30 дней) — текущая, более отзывчивая к недавним решениям. */
  accuracy: number | null
  /** Насколько статистика «свежая»: эффективное число показов после затухания. */
  sampleEff: number
}

export interface InboundLetterStatsDto {
  groups: InboundLetterGroupStatsDto[]
  generatedAt: string
}
