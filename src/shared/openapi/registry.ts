import type { z } from '@/shared/zod'
import type { ErrorCode } from '@/shared/http/errors'
import type { Permission } from '@/shared/auth/permissions'

import { auditListQuerySchema, universityEventsQuerySchema } from '@/modules/audit/audit.schema'
import { exportQuerySchema } from '@/modules/export/export.schema'
import { importQuerySchema } from '@/modules/import/import.schema'
import { notificationFeedQuerySchema } from '@/modules/notifications/notifications.schema'
import { searchQuerySchema } from '@/modules/search/search.schema'
import { userListQuerySchema } from '@/modules/auth/auth.schema'
import {
  cooperationListQuerySchema,
  createCooperationSchema,
  updateCooperationSchema,
} from '@/modules/cooperation/cooperation.schema'
import {
  dataSourceListQuerySchema,
  syncMarketDataSchema,
} from '@/modules/data-sources/data-sources.schema'
import {
  changeDocumentStatusSchema,
  createDocumentSchema,
  documentListQuerySchema,
  generateDocumentsSchema,
  updateDocumentSchema,
} from '@/modules/documents/documents.schema'
import {
  createMeetingSchema,
  meetingListQuerySchema,
  updateMeetingSchema,
} from '@/modules/meetings/meetings.schema'
import {
  applicationListQuerySchema,
  confirmMaterialSchema,
  submitApplicationSchema,
  updateProgramMetricsSchema,
} from '@/modules/portal/portal.schema'
import {
  productListQuerySchema,
  releasePreviewQuerySchema,
  releaseProductVersionSchema,
} from '@/modules/products/products.schema'
import {
  createProgramSchema,
  programListQuerySchema,
  setProgramSkillsSchema,
  updateProgramSchema,
} from '@/modules/programs/programs.schema'
import {
  recommendationListQuerySchema,
  updateRecommendationSchema,
} from '@/modules/recommendations/recommendations.schema'
import {
  skillDemandQuerySchema,
  skillGapQuerySchema,
  skillListQuerySchema,
} from '@/modules/skills/skills.schema'
import {
  createUniversitySchema,
  universityListQuerySchema,
  updateUniversitySchema,
} from '@/modules/universities/universities.schema'
import {
  stageListQuerySchema,
  updateStageSchema,
  updateTaskSchema,
} from '@/modules/workflow/workflow.schema'

/**
 * Реестр эндпоинтов для сборки спецификации OpenAPI.
 *
 * Схемы берутся прямо из модулей, поэтому описание параметров и тел запросов
 * не может разойтись с кодом: изменил схему — изменилась спецификация.
 *
 * Полнота реестра проверяется тестом: он сверяет список с файлами маршрутов
 * в `src/app/api` и падает, если появился маршрут без описания.
 */
export interface EndpointSpec {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  /** Путь в нотации OpenAPI: параметры в фигурных скобках. */
  path: string
  tag: string
  summary: string
  description?: string
  /** Требуемое право. 'ANY' — доступно любому определённому пользователю. */
  permission: Permission | 'ANY'
  query?: z.ZodType
  body?: z.ZodType
  /** Тело необязательно: все поля имеют значения по умолчанию. */
  bodyOptional?: boolean
  /** Ответ — список с блоком meta. */
  list?: boolean
  errors: ErrorCode[]
}

const COMMON_ERRORS: ErrorCode[] = ['UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL']
const READ_ERRORS: ErrorCode[] = [...COMMON_ERRORS, 'NOT_FOUND']
const WRITE_ERRORS: ErrorCode[] = [...READ_ERRORS, 'VALIDATION_ERROR']

export const ENDPOINTS: readonly EndpointSpec[] = [
  // ── Служебное ─────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/health',
    tag: 'Служебное',
    summary: 'Проверка живости приложения и подключения к базе',
    permission: 'ANY',
    errors: ['INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/openapi.json',
    tag: 'Служебное',
    summary: 'Спецификация OpenAPI этого API',
    permission: 'ANY',
    errors: ['INTERNAL'],
  },

  // ── Пользователи ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/me',
    tag: 'Пользователи',
    summary: 'Текущий пользователь и его права',
    description:
      'Фронт по полю permissions решает, какие разделы показывать, ' +
      'вместо дублирования матрицы доступа.',
    permission: 'ANY',
    errors: ['UNAUTHORIZED', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/me/stats',
    tag: 'Пользователи',
    summary: 'Личная статистика для личного кабинета',
    description:
      'Активные связки, вузы в работе, программы под управлением, доля этапов в срок ' +
      'и просроченные — по связкам и этапам, где текущий пользователь ответственный.',
    permission: 'ANY',
    errors: ['UNAUTHORIZED', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/notifications',
    tag: 'Пользователи',
    summary: 'Лента уведомлений текущего пользователя',
    description:
      'Сроки своих этапов, изменения по своим связкам и документам, важные рекомендации. ' +
      'Прочитанность хранит фронт: отметку последнего просмотра он передаёт в since.',
    query: notificationFeedQuerySchema,
    permission: 'READ',
    errors: ['UNAUTHORIZED', 'VALIDATION_ERROR', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/search',
    tag: 'Пользователи',
    summary: 'Глобальный поиск по разделам',
    description:
      'Вузы, программы, связки, продукты, навыки и документы одним запросом, ' +
      'сгруппированные по разделам. Права и видимость — как у соответствующих списков. ' +
      'Связки ищутся по словам: каждое слово — в полном или кратком имени вуза, программе, ' +
      'продукте, цели или ФИО ответственного.',
    query: searchQuerySchema,
    permission: 'READ',
    errors: ['UNAUTHORIZED', 'VALIDATION_ERROR', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/users',
    tag: 'Пользователи',
    summary: 'Справочник пользователей',
    description: 'Нужен для выбора ответственного и участников встреч.',
    permission: 'ANALYTICS',
    query: userListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },

  // ── Университеты ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/universities',
    tag: 'Университеты',
    summary: 'Реестр университетов',
    permission: 'READ',
    query: universityListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/universities',
    tag: 'Университеты',
    summary: 'Создать университет',
    permission: 'WRITE',
    body: createUniversitySchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/universities/{id}',
    tag: 'Университеты',
    summary: 'Карточка университета',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/universities/{id}',
    tag: 'Университеты',
    summary: 'Изменить университет',
    permission: 'WRITE',
    body: updateUniversitySchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/universities/{id}/archive',
    tag: 'Университеты',
    summary: 'Архивировать университет',
    description: 'Отклоняется, если у вуза есть незакрытые связки.',
    permission: 'WRITE',
    errors: [...READ_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/universities/{id}/restore',
    tag: 'Университеты',
    summary: 'Вернуть университет из архива',
    permission: 'WRITE',
    errors: READ_ERRORS,
  },
  {
    method: 'get',
    path: '/api/universities/{id}/events',
    tag: 'Университеты',
    summary: 'Лента последних событий вуза',
    description: 'Собирается из истории этапов, документов, встреч и заявок.',
    permission: 'READ',
    query: universityEventsQuerySchema,
    errors: READ_ERRORS,
  },

  // ── Программы ─────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/programs',
    tag: 'Программы',
    summary: 'Список образовательных программ',
    permission: 'READ',
    query: programListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/programs',
    tag: 'Программы',
    summary: 'Создать образовательную программу',
    permission: 'WRITE',
    body: createProgramSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/programs/{id}',
    tag: 'Программы',
    summary: 'Карточка программы',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/programs/{id}',
    tag: 'Программы',
    summary: 'Изменить программу',
    permission: 'WRITE',
    body: updateProgramSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'put',
    path: '/api/programs/{id}/skills',
    tag: 'Программы',
    summary: 'Заменить набор навыков программы',
    description: 'Полная замена: пустой список снимает все навыки.',
    permission: 'WRITE',
    body: setProgramSkillsSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'post',
    path: '/api/programs/{id}/archive',
    tag: 'Программы',
    summary: 'Архивировать программу',
    permission: 'WRITE',
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/programs/{id}/restore',
    tag: 'Программы',
    summary: 'Вернуть программу из архива',
    description: 'Отклоняется, если вуз программы находится в архиве.',
    permission: 'WRITE',
    errors: WRITE_ERRORS,
  },

  // ── Навыки ────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/skills',
    tag: 'Навыки',
    summary: 'Справочник навыков',
    permission: 'READ',
    query: skillListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/skills/demand',
    tag: 'Навыки',
    summary: 'Востребованность навыков на рынке',
    description: 'Каждая строка несёт источник, период и признак демонстрационных данных.',
    permission: 'ANALYTICS',
    query: skillDemandQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/skills/gaps',
    tag: 'Навыки',
    summary: 'Дефицит навыков (skill gap)',
    permission: 'ANALYTICS',
    query: skillGapQuerySchema,
    list: true,
    errors: READ_ERRORS,
  },

  // ── Продукты ──────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/products',
    tag: 'IT-продукты',
    summary: 'Реестр IT-продуктов',
    permission: 'READ',
    query: productListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/products/{id}',
    tag: 'IT-продукты',
    summary: 'Карточка IT-продукта',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'get',
    path: '/api/products/{id}/release',
    tag: 'IT-продукты',
    summary: 'Предпросмотр выпуска новой версии',
    description: 'Показывает, какие связки затронет групповая операция. Ничего не меняет.',
    permission: 'WRITE',
    query: releasePreviewQuerySchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'post',
    path: '/api/products/{id}/release',
    tag: 'IT-продукты',
    summary: 'Выпустить новую версию продукта',
    description:
      'Групповая операция: ставит задачи во всех связках с этим продуктом ' +
      'и переоткрывает закрытые этапы передачи материалов.',
    permission: 'WRITE',
    body: releaseProductVersionSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },

  // ── Сотрудничество ────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/cooperations',
    tag: 'Сотрудничество',
    summary: 'Список связок',
    description:
      'q — поиск по словам без учёта регистра: каждое слово найдено хотя бы в одном поле — ' +
      'полное или краткое имя вуза, программа, продукт, цель, ФИО ответственного.',
    permission: 'READ',
    query: cooperationListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/cooperations',
    tag: 'Сотрудничество',
    summary: 'Создать связку',
    description: 'Сразу создаются все 14 этапов с чек-листами и нормативными сроками.',
    permission: 'WRITE',
    body: createCooperationSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/cooperations/{id}',
    tag: 'Сотрудничество',
    summary: 'Карточка связки со всеми этапами',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/cooperations/{id}',
    tag: 'Сотрудничество',
    summary: 'Изменить связку',
    permission: 'WRITE',
    body: updateCooperationSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'get',
    path: '/api/cooperations/{id}/stages',
    tag: 'Сотрудничество',
    summary: 'Этапы связки',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/cooperations/{id}/documents/generate',
    tag: 'Документы',
    summary: 'Собрать пакет документов из шаблонов',
    description:
      'Реквизиты подставляются автоматически. Недостающие заменяются видимым прочерком ' +
      'и перечисляются в ответе.',
    permission: 'WRITE',
    body: generateDocumentsSchema,
    bodyOptional: true,
    errors: WRITE_ERRORS,
  },

  // ── Workflow ──────────────────────────────────────────────────────────────
  {
    method: 'patch',
    path: '/api/workflow/stages/{id}',
    tag: 'Workflow',
    summary: 'Изменить этап',
    description: 'Недопустимый переход статуса возвращает INVALID_TRANSITION 409.',
    permission: 'WRITE',
    body: updateStageSchema,
    errors: [...WRITE_ERRORS, 'INVALID_TRANSITION'],
  },
  {
    method: 'get',
    path: '/api/workflow/stages/{id}/history',
    tag: 'Workflow',
    summary: 'История изменений этапа',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/workflow/tasks/{id}',
    tag: 'Workflow',
    summary: 'Отметить пункт чек-листа',
    description:
      'В ответе — этап целиком, чтобы фронт обновил прогресс без второго запроса. ' +
      'Закрытая связка или этап — конфликт; пункт контрольной точки до закрытия ' +
      'предыдущих этапов — недопустимый переход.',
    permission: 'WRITE',
    body: updateTaskSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT', 'INVALID_TRANSITION'],
  },
  {
    method: 'get',
    path: '/api/workflow/overdue',
    tag: 'Workflow',
    summary: 'Просроченные этапы',
    permission: 'READ',
    query: stageListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/workflow/blocked',
    tag: 'Workflow',
    summary: 'Заблокированные этапы',
    permission: 'READ',
    query: stageListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },

  // ── Аналитика ─────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/analytics/overview',
    tag: 'Аналитика',
    summary: 'Сводка главной страницы',
    description: 'У каждого показателя есть происхождение и признак демонстрационных данных.',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/analytics/programs',
    tag: 'Аналитика',
    summary: 'Рейтинг программ с раскрытием вклада показателей',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },

  // ── Рекомендации ──────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/recommendations/generate',
    tag: 'Рекомендации',
    summary: 'Пересобрать рекомендации по правилам',
    description: 'Не плодит дубликаты и не переписывает решение сотрудника.',
    permission: 'WRITE',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/recommendations',
    tag: 'Рекомендации',
    summary: 'Список рекомендаций',
    permission: 'ANALYTICS',
    query: recommendationListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/recommendations/{id}',
    tag: 'Рекомендации',
    summary: 'Карточка рекомендации',
    permission: 'ANALYTICS',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/recommendations/{id}',
    tag: 'Рекомендации',
    summary: 'Принять, отложить или отклонить рекомендацию',
    description: 'Отклонение требует комментария с основанием.',
    permission: 'WRITE',
    body: updateRecommendationSchema,
    errors: WRITE_ERRORS,
  },

  // ── Документы ─────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/documents',
    tag: 'Документы',
    summary: 'Список документов',
    permission: 'READ',
    query: documentListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/documents',
    tag: 'Документы',
    summary: 'Создать документ',
    description: 'Хранятся метаданные и ссылка. Загрузка файлов — P2.',
    permission: 'WRITE',
    body: createDocumentSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/documents/{id}',
    tag: 'Документы',
    summary: 'Карточка документа с историей статусов',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/documents/{id}',
    tag: 'Документы',
    summary: 'Изменить документ',
    description: 'Подписанный и архивный документ не редактируются.',
    permission: 'WRITE',
    body: updateDocumentSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'patch',
    path: '/api/documents/{id}/status',
    tag: 'Документы',
    summary: 'Сменить статус документа',
    permission: 'WRITE',
    body: changeDocumentStatusSchema,
    errors: [...WRITE_ERRORS, 'INVALID_TRANSITION'],
  },
  {
    method: 'post',
    path: '/api/documents/{id}/versions',
    tag: 'Документы',
    summary: 'Создать новую версию документа',
    description: 'Исходный документ уходит в архив.',
    permission: 'WRITE',
    errors: READ_ERRORS,
  },
  {
    method: 'get',
    path: '/api/document-templates',
    tag: 'Документы',
    summary: 'Шаблоны документов и доступные подстановки',
    permission: 'READ',
    errors: COMMON_ERRORS,
  },

  // ── Встречи ───────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/meetings',
    tag: 'Встречи',
    summary: 'Список встреч',
    permission: 'READ',
    query: meetingListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/meetings',
    tag: 'Встречи',
    summary: 'Создать встречу',
    description: 'Если задано следующее действие, обязателен его срок.',
    permission: 'WRITE',
    body: createMeetingSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/meetings/{id}',
    tag: 'Встречи',
    summary: 'Карточка встречи',
    permission: 'READ',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/meetings/{id}',
    tag: 'Встречи',
    summary: 'Изменить встречу',
    description: 'Список участников заменяется целиком, если передан.',
    permission: 'WRITE',
    body: updateMeetingSchema,
    errors: WRITE_ERRORS,
  },

  // ── Кабинет вуза ──────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/portal/overview',
    tag: 'Кабинет вуза',
    summary: 'Сводка кабинета представителя вуза',
    description:
      'Представитель видит только свой вуз. Сотрудник ИТ-Школы указывает вуз параметром.',
    permission: 'UNIVERSITY_PORTAL',
    errors: READ_ERRORS,
  },
  {
    method: 'get',
    path: '/api/portal/materials',
    tag: 'Кабинет вуза',
    summary: 'Переданные вузу материалы',
    permission: 'UNIVERSITY_PORTAL',
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/portal/materials/{taskId}/confirm',
    tag: 'Кабинет вуза',
    summary: 'Подтвердить получение материалов',
    description:
      'Подтверждать можно только задачи этапа передачи материалов. Закрытая связка ' +
      'или завершённый либо отменённый этап — конфликт, не закрытые этапы до 7-го — ' +
      'недопустимый переход, как у сотрудника ИТ-Школы.',
    permission: 'UNIVERSITY_PORTAL',
    body: confirmMaterialSchema,
    bodyOptional: true,
    errors: [...WRITE_ERRORS, 'CONFLICT', 'INVALID_TRANSITION'],
  },
  {
    method: 'patch',
    path: '/api/portal/programs/{id}/metrics',
    tag: 'Кабинет вуза',
    summary: 'Внести численность обучающихся и количество групп',
    description: 'Заявки через кабинет не правятся: они считаются по поданным заявкам.',
    permission: 'UNIVERSITY_PORTAL',
    body: updateProgramMetricsSchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/portal/applications',
    tag: 'Кабинет вуза',
    summary: 'Заявки на обучение',
    permission: 'UNIVERSITY_PORTAL',
    query: applicationListQuerySchema,
    list: true,
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/portal/applications',
    tag: 'Кабинет вуза',
    summary: 'Подать заявку на обучение',
    description: 'Персональных данных обучающихся заявка не содержит.',
    permission: 'UNIVERSITY_PORTAL',
    body: submitApplicationSchema,
    errors: WRITE_ERRORS,
  },

  // ── Источники данных и журнал ─────────────────────────────────────────────
  {
    method: 'get',
    path: '/api/data-sources',
    tag: 'Источники данных',
    summary: 'Источники данных с происхождением',
    permission: 'ANALYTICS',
    query: dataSourceListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/data-sources/sync',
    tag: 'Источники данных',
    summary: 'Загрузить рыночные данные из активного источника',
    description: 'Сбой источника возвращает INTEGRATION_ERROR 502 и не затрагивает систему.',
    permission: 'WRITE',
    body: syncMarketDataSchema,
    bodyOptional: true,
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR', 'INTEGRATION_ERROR'],
  },
  {
    method: 'get',
    path: '/api/integrations/status',
    tag: 'Источники данных',
    summary: 'Состояние интеграций',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/export',
    tag: 'Выгрузка',
    summary: 'Выгрузка реестра в CSV',
    description:
      'Файл для Excel: UTF-8 с BOM, разделитель — точка с запятой, дробные числа — с запятой, ' +
      'перечисления — русскими словами. Права совпадают с правами соответствующего раздела. ' +
      'Для universities, programs и cooperations принимаются фильтры и сортировка их списков ' +
      '(те же параметры, что у GET /api/<раздел>, кроме page и pageSize).',
    permission: 'READ',
    query: exportQuerySchema,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/import',
    tag: 'Выгрузка',
    summary: 'Загрузка реестра из CSV',
    description:
      'Тело запроса — сам файл (text/csv). По умолчанию предпросмотр: запись происходит ' +
      'только при mode=apply. Колонки совпадают с заголовками выгрузки. Разделитель «;» или «,» ' +
      'определяется по строке заголовков.',
    permission: 'WRITE',
    query: importQuerySchema,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/audit',
    tag: 'Журнал',
    summary: 'Журнал критичных действий',
    description: 'Доступен только администратору.',
    permission: 'ADMIN',
    query: auditListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
]

/**
 * Маршруты, которые в спецификацию намеренно не попадают.
 * NextAuth описывает свои эндпоинты сам, и дублировать их здесь нечем.
 */
export const EXCLUDED_ROUTES: readonly string[] = [
  '/auth/[...nextauth]',
  // Перехватывающий сегмент: отвечает JSON-ошибкой на несуществующий адрес.
  // Это не эндпоинт с контрактом, а замена HTML-странице 404.
  '/[...unknown]',
]
