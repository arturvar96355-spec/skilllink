import type { z } from '@/shared/zod'
import type { ErrorCode } from '@/shared/http/errors'
import type { Permission } from '@/shared/auth/permissions'

import { auditListQuerySchema, universityEventsQuerySchema } from '@/modules/audit/audit.schema'
import { paginationSchema } from '@/shared/http/pagination'
import { exportQuerySchema } from '@/modules/export/export.schema'
import {
  createDsarRequestSchema,
  dsarRequestListQuerySchema,
  eraseSubjectSchema,
} from '@/modules/dsar/dsar.schema'
import { importQuerySchema } from '@/modules/import/import.schema'
import { notificationFeedQuerySchema } from '@/modules/notifications/notifications.schema'
import { searchQuerySchema } from '@/modules/search/search.schema'
import { telegramUpdateSchema } from '@/modules/telegram/telegram.schema'
import { funnelQuerySchema, stalledPreviewQuerySchema } from '@/modules/analytics/stage-analytics.schema'
import {
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@/modules/auth/auth.schema'
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
  createProductSchema,
  productListQuerySchema,
  releasePreviewQuerySchema,
  releaseProductVersionSchema,
  setProductSkillsSchema,
  updateProductSchema,
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
  whyNotQuerySchema,
} from '@/modules/recommendations/recommendations.schema'
import {
  createSkillSchema,
  mergeSkillSchema,
  skillDemandQuerySchema,
  skillGapQuerySchema,
  skillListQuerySchema,
  updateSkillSchema,
} from '@/modules/skills/skills.schema'
import {
  contactBasisHistoryQuerySchema,
  createUniversitySchema,
  setContactBasisSchema,
  universityListQuerySchema,
  updateUniversitySchema,
  withdrawConsentSchema,
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
  /** POST, который ничего не создаёт (черновик ИИ-помощника), отвечает 200, а не 201. */
  returnsOk?: boolean
  /** Без входа: доступ даёт не cookie сессии, а сам адрес (лента календаря). */
  public?: boolean
  /** Успешный ответ — не JSON `{ data }`, а файл этого типа. */
  fileContentType?: string
  /** Описания параметров пути, если это не идентификатор записи. */
  pathParams?: Record<string, string>
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
  {
    method: 'get',
    path: '/api/login-challenge',
    tag: 'Служебное',
    summary: 'Задача проверки «не робот» для входа',
    description:
      'Без входа. Нужна, когда вход ответил code=captcha_required (после трёх неудач подряд): ' +
      'найти число от 0 до maxNumber, при котором SHA-256 от salt + число равен challenge, ' +
      'и повторить вход с полем captcha. Решение действует один раз и живёт 5 минут (решение 100).',
    permission: 'ANY',
    errors: ['INTERNAL'],
  },
  {
    method: 'post',
    path: '/api/telegram/webhook',
    tag: 'Служебное',
    summary: 'Вебхук бота личных уведомлений (вызывает Telegram)',
    description:
      'Без входа: подлинность — заголовок X-Telegram-Bot-Api-Secret-Token, равный ' +
      'TELEGRAM_WEBHOOK_SECRET; без него или с другим — 403. Команды: /start <токен> — привязать ' +
      'чат, /today — сводка, /stop — отвязать, прочее — справка. Отвечает 200 сразу ' +
      '({ accepted }), команду выполняет после ответа; нераспознанное тело — тоже 200 (решение 102).',
    body: telegramUpdateSchema,
    permission: 'ANY',
    returnsOk: true,
    errors: ['FORBIDDEN', 'INTERNAL'],
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
    path: '/api/me/pulse',
    tag: 'Пользователи',
    summary: 'Пульс: «Внимание», «Сегодня», «Решить», «Успехи» по моим связкам',
    description:
      'Решение 120. То же содержимое, что сводка в Telegram. Разделы с потолком пунктов, total — ' +
      'сколько всего; checkedRules — сколько правил проверено; пустой пульс — isCalm и calmText.',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/me/calendar',
    tag: 'Пользователи',
    summary: 'Есть ли личная ссылка на календарь сроков и встреч',
    description:
      'Только признак и время выпуска: сам адрес ленты показывается один раз, при выпуске (решение 105).',
    permission: 'CALENDAR',
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/me/calendar',
    tag: 'Пользователи',
    summary: 'Выпустить или перевыпустить ссылку на календарь (.ics)',
    description:
      'Тела нет. В ответе url и webcalUrl — один раз; в базе хранится только SHA-256 токена. ' +
      'Перевыпуск сразу закрывает прежнюю ссылку. Ссылка = доступ без входа: хранить как пароль. ' +
      'В журнал — calendar.issue без токена.',
    permission: 'CALENDAR',
    errors: COMMON_ERRORS,
  },
  {
    method: 'delete',
    path: '/api/me/calendar',
    tag: 'Пользователи',
    summary: 'Отозвать ссылку на календарь',
    description:
      'Прежний адрес ленты сразу отвечает 404. Повторный отзыв — 200 с revoked=false. ' +
      'В журнал — calendar.revoke.',
    permission: 'CALENDAR',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/calendar/{feed}',
    tag: 'Пользователи',
    summary: 'Лента календаря сроков и встреч (iCalendar)',
    description:
      'Без входа: календарные приложения cookie не шлют, доступ даёт токен в адресе. ' +
      'Ответ — text/calendar (RFC 5545): сроки незавершённых этапов, где владелец ссылки ' +
      'ответственный за этап или связку (события на весь день), и его встречи. ' +
      'Неизвестный или отозванный токен, заблокированный владелец — одинаково 404.',
    permission: 'ANY',
    public: true,
    fileContentType: 'text/calendar',
    pathParams: { feed: 'Имя файла ленты: <токен>.ics — токен из ответа POST /api/me/calendar' },
    errors: ['NOT_FOUND', 'INTERNAL'],
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
    method: 'post',
    path: '/api/me/password',
    tag: 'Пользователи',
    summary: 'Сменить свой пароль',
    description:
      'Любая роль, только для себя. Новый пароль — не короче 10 символов, не длиннее 72 байт, ' +
      'не совпадает с текущим и с почтой. Неверный текущий пароль — 422; проверка идёт ' +
      'под тем же ограничением перебора, что и вход: после пяти неудач — 403 на 15 минут.',
    body: changePasswordSchema,
    permission: 'ANY',
    returnsOk: true,
    errors: ['UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION_ERROR', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/me/telegram',
    tag: 'Пользователи',
    summary: 'Уведомления в Telegram: состояние для личного кабинета',
    description:
      'configured — бот настроен администратором (иначе блок пишет «Не настроено администратором»); ' +
      'available — сводка доступна роли (представителю вуза — нет); linked, username, linkedAt — ' +
      'привязка текущего пользователя (решение 102).',
    permission: 'READ',
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/me/telegram',
    tag: 'Пользователи',
    summary: 'Уведомления в Telegram: ссылка на бота для подключения',
    description:
      'Отдаёт url вида https://t.me/<бот>?start=<токен> и срок expiresAt. Токен — HMAC над id ' +
      'пользователя и сроком, живёт 15 минут, срабатывает один раз; в базе не хранится. ' +
      'Привязка появляется, когда пользователь нажмёт «Старт» в Telegram. Бот не настроен — 502. Тело не нужно.',
    permission: 'ANALYTICS',
    returnsOk: true,
    errors: ['UNAUTHORIZED', 'FORBIDDEN', 'INTEGRATION_ERROR', 'INTERNAL'],
  },
  {
    method: 'delete',
    path: '/api/me/telegram',
    tag: 'Пользователи',
    summary: 'Уведомления в Telegram: отключить',
    description:
      'Удаляет привязку текущего пользователя и отдаёт новое состояние. Повтор — не ошибка; ' +
      'работает и при выключенном боте.',
    permission: 'READ',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/users',
    tag: 'Пользователи',
    summary: 'Справочник пользователей',
    description:
      'Нужен для выбора ответственного и участников встреч; администратору — для вкладки ' +
      '«Пользователи» (фильтр isActive).',
    permission: 'ANALYTICS',
    query: userListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'post',
    path: '/api/users',
    tag: 'Пользователи',
    summary: 'Завести пользователя',
    description:
      'Почта уникальна и хранится в нижнем регистре; у UNIVERSITY_REP вуз обязателен, ' +
      'у остальных запрещён. Сервер генерирует временный пароль и отдаёт его один раз ' +
      'в ответе (temporaryPassword); в базе — только хеш bcrypt.',
    body: createUserSchema,
    permission: 'ADMIN',
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'get',
    path: '/api/users/{id}',
    tag: 'Пользователи',
    summary: 'Пользователь для администратора',
    description: 'С числом открытых связок и этапов, где он ответственный, — для предупреждения о блокировке.',
    permission: 'ADMIN',
    errors: READ_ERRORS,
  },
  {
    method: 'patch',
    path: '/api/users/{id}',
    tag: 'Пользователи',
    summary: 'Изменить пользователя: ФИО, должность, роль, блокировка',
    description:
      'Себя нельзя заблокировать и лишить роли ADMIN; нельзя оставить систему без действующего ' +
      'администратора; менеджера с открытыми связками или этапами нельзя перевести в роль, ' +
      'которая не может быть ответственным, — всё это 409. Блокировка действует сразу, ' +
      'в том числе на уже выданные сессии.',
    body: updateUserSchema,
    permission: 'ADMIN',
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/users/{id}/password-reset',
    tag: 'Пользователи',
    summary: 'Выдать новый временный пароль',
    description:
      'Пароль приходит один раз в ответе, старый перестаёт подходить сразу, блокировка входа ' +
      'после неудачных попыток с учётной записи снимается. Свой пароль так не меняется — 409.',
    permission: 'ADMIN',
    returnsOk: true,
    errors: [...READ_ERRORS, 'CONFLICT'],
  },

  // ── Права субъекта ПД (решение 116) ──────────────────────────────────────
  {
    method: 'get',
    path: '/api/me/data-export',
    tag: 'Права субъекта ПД',
    summary: 'Мои данные: выгрузить всё, что система знает обо мне',
    description:
      'Ст. 14 152-ФЗ. Любая роль, только о себе. JSON вложением (Content-Disposition: attachment, ' +
      'Cache-Control: no-store): сведения ч. 7 ст. 14, данные по разделам реестра DSAR и журнал — ' +
      'мои действия и действия надо мной. Не чаще раза в 10 минут — иначе 409 с details.retryAfterSeconds. ' +
      'Регистрируется в реестре запросов исполненным (канал SELF_SERVICE), в журнал — dsar.exported.',
    permission: 'ANY',
    fileContentType: 'application/json',
    errors: ['UNAUTHORIZED', 'CONFLICT', 'INTERNAL'],
  },
  {
    method: 'get',
    path: '/api/admin/dsar/users/{id}/export',
    tag: 'Права субъекта ПД',
    summary: 'Всё о субъекте: выгрузка по пользователю системы',
    description:
      'Ст. 14 152-ФЗ. JSON вложением, без сохранения в браузере: subject, operator, purposes, legalBasis, categories, sources, ' +
      'recipients, retention, data (по разделам с total и пределом 500), auditTrail.byActor и aboutSubject, counts. ' +
      'Паролей, хешей и токенов нет. Закрывает открытый запрос на сведения, иначе регистрирует исполненный.',
    permission: 'DSAR_MANAGE',
    fileContentType: 'application/json',
    errors: READ_ERRORS,
  },
  {
    method: 'get',
    path: '/api/admin/dsar/contacts/{id}/export',
    tag: 'Права субъекта ПД',
    summary: 'Всё о субъекте: выгрузка по контактному лицу вуза',
    description:
      'Как выгрузка по пользователю: карточка контакта с основанием обработки и согласием, история основания, ' +
      'встречи, документы с упоминанием ФИО, журнал действий над контактом.',
    permission: 'DSAR_MANAGE',
    fileContentType: 'application/json',
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/admin/dsar/users/{id}/erase',
    tag: 'Права субъекта ПД',
    summary: 'Обезличить пользователя по запросу субъекта',
    description:
      'Ст. 20, 21 152-ФЗ. Тело { confirm: почта для входа }. В одной транзакции по реестру: ФИО, почта, должность — заглушка, ' +
      'пароль стёрт, блокировка, версия сессий +1, ссылка календаря и привязка Telegram удалены; ссылки и журнал ' +
      'остаются. Себя, последнего администратора, общую демо-учётку и сотрудника с открытой работой — 409. ' +
      'Необратимо; повтор — 200 с alreadyErased.',
    permission: 'DSAR_MANAGE',
    body: eraseSubjectSchema,
    returnsOk: true,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/admin/dsar/contacts/{id}/erase',
    tag: 'Права субъекта ПД',
    summary: 'Обезличить контактное лицо вуза по запросу субъекта',
    description:
      'Тот же набор полей, что у обезличивания в карточке вуза, и закрытие запроса в реестре. ' +
      'Тело { confirm: ФИО контакта }. Необратимо; повтор — 200 с alreadyErased.',
    permission: 'DSAR_MANAGE',
    body: eraseSubjectSchema,
    returnsOk: true,
    errors: WRITE_ERRORS,
  },
  {
    method: 'get',
    path: '/api/admin/dsar/requests',
    tag: 'Права субъекта ПД',
    summary: 'Реестр запросов субъектов ПД',
    description:
      'Новые сверху; фильтры status, kind, subjectType, subjectId, overdue=true (открытые с прошедшим сроком). ' +
      'Срок: 10 рабочих дней на сведения (ч. 3 ст. 14), 7 — на уничтожение (ч. 3 ст. 20).',
    permission: 'DSAR_MANAGE',
    query: dsarRequestListQuerySchema,
    list: true,
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'post',
    path: '/api/admin/dsar/requests',
    tag: 'Права субъекта ПД',
    summary: 'Зарегистрировать запрос субъекта, пришедший письмом',
    description:
      'Срок ответа — от receivedAt (не в будущем, не старше 30 дней). Открытый запрос того же вида о том же ' +
      'субъекте — 409 с details.requestId. Текст письма и ФИО не хранятся. В журнал — dsar.requested.',
    permission: 'DSAR_MANAGE',
    body: createDsarRequestSchema,
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR', 'CONFLICT'],
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
    description:
      'Почта и телефон контактных лиц — только ADMIN и MANAGER, представителю вуза — своего вуза ' +
      '(решение 106). Остальным `email` и `phone` = null и `contactDetailsHidden: true`; ФИО и должность видны.',
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
    method: 'post',
    path: '/api/universities/{id}/contacts/{contactId}/anonymize',
    tag: 'Университеты',
    summary: 'Обезличить контактное лицо вуза',
    description:
      'Право субъекта на удаление ПД (docs/PRIVACY.md): ФИО, должность, почта, телефон и заметки стираются, ' +
      'запись остаётся ради связей. Необратимо; повтор возвращает тот же результат.',
    permission: 'ADMIN',
    returnsOk: true,
    errors: READ_ERRORS,
  },
  {
    method: 'put',
    path: '/api/universities/{id}/contacts/{contactId}/legal-basis',
    tag: 'Университеты',
    summary: 'Зафиксировать правовое основание обработки ПД контакта',
    description:
      'Решение 111: основание по ч. 1 ст. 6 152-ФЗ и документ-основание; при согласии — дата получения ' +
      '(не в будущем) и форма. Повтор той же формы ничего не меняет. Обезличенный контакт и отозванное ' +
      'согласие — 409. В журнал — коды «было → стало» без текста документа.',
    permission: 'CONTACT_BASIS',
    body: setContactBasisSchema,
    returnsOk: true,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/universities/{id}/contacts/{contactId}/consent/withdraw',
    tag: 'Университеты',
    summary: 'Отозвать согласие контакта — контакт обезличивается',
    description:
      'Ч. 5 ст. 21 152-ФЗ. Только когда основание — действующее согласие; иначе 409. Согласие — ' +
      'единственное основание, поэтому контакт сразу обезличивается тем же набором полей, что и ' +
      '`anonymize`. Документ отзыва обязателен. Необратимо; повтор возвращает тот же результат.',
    permission: 'CONTACT_BASIS',
    body: withdrawConsentSchema,
    returnsOk: true,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'get',
    path: '/api/universities/{id}/contacts/{contactId}/legal-basis/history',
    tag: 'Университеты',
    summary: 'История основания обработки ПД и согласия контакта',
    description: 'Кто, когда, что было → что стало. Без комментариев и текста документов. Новые сверху.',
    permission: 'CONTACT_BASIS',
    query: contactBasisHistoryQuerySchema,
    list: true,
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
    method: 'post',
    path: '/api/skills',
    tag: 'Навыки',
    summary: 'Добавить навык в справочник',
    description:
      'Только администратор (решение 107). Название уникально без учёта регистра и пробелов: ' +
      '«Machine Learning», «machine learning» и «MachineLearning» — один навык, повтор — 409. ' +
      'Пробелы внутри названия сводятся к одному.',
    body: createSkillSchema,
    permission: 'ADMIN',
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR', 'CONFLICT'],
  },
  {
    method: 'patch',
    path: '/api/skills/{id}',
    tag: 'Навыки',
    summary: 'Переименовать навык, сменить категорию или описание',
    description: 'Только администратор. Новое название проверяется на дубль так же, как при создании — 409.',
    body: updateSkillSchema,
    permission: 'ADMIN',
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'delete',
    path: '/api/skills/{id}',
    tag: 'Навыки',
    summary: 'Удалить неиспользуемый навык',
    description:
      'Только администратор. Навык, который есть хотя бы в одной программе, продукте, рыночном ' +
      'показателе или рекомендации, не удаляется — 409 с числом использований ' +
      '(details.usage: programs, products, demand, recommendations). Дубль убирается объединением.',
    permission: 'ADMIN',
    errors: [...READ_ERRORS, 'CONFLICT'],
  },
  {
    method: 'post',
    path: '/api/skills/{id}/merge',
    tag: 'Навыки',
    summary: 'Объединить дубль в другой навык',
    description:
      'Только администратор. Связи программ и продуктов, рыночные показатели и рекомендации дубля ' +
      'переходят на targetId, дубль удаляется — одной транзакцией. Если связь есть у обоих, остаётся ' +
      'более сильная: у программы — наибольшие уровень, важность и уверенность; у продукта — ' +
      'наибольшая значимость; у рыночного показателя того же периода, источника и региона — ' +
      'наибольшее значение; рекомендация того же правила — целевого навыка.',
    body: mergeSkillSchema,
    permission: 'ADMIN',
    returnsOk: true,
    errors: WRITE_ERRORS,
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
    method: 'post',
    path: '/api/products',
    tag: 'IT-продукты',
    summary: 'Завести IT-продукт',
    description: 'Название уникально без учёта регистра: дубль — CONFLICT.',
    permission: 'WRITE',
    body: createProductSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
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
    method: 'patch',
    path: '/api/products/{id}',
    tag: 'IT-продукты',
    summary: 'Изменить IT-продукт',
    description:
      'Частичное изменение. Дубль названия — CONFLICT. Версию продукта с открытыми связками ' +
      'меняет выпуск версии, а не правка карточки — CONFLICT.',
    permission: 'WRITE',
    body: updateProductSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
  },
  {
    method: 'put',
    path: '/api/products/{id}/skills',
    tag: 'IT-продукты',
    summary: 'Заменить набор навыков продукта',
    description: 'Полная замена: пустой список снимает все навыки.',
    permission: 'WRITE',
    body: setProductSkillsSchema,
    errors: WRITE_ERRORS,
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
    description:
      'Сразу создаются все 14 этапов с чек-листами и нормативными сроками. ' +
      'Вторая незакрытая связка с тем же «вуз + программа + IT-продукт» — CONFLICT ' +
      'с details.cooperationId существующей.',
    permission: 'WRITE',
    body: createCooperationSchema,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
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
      'и перечисляются в ответе. Шаблон, по которому в связке уже есть документ, ' +
      'и лицензия без выбранного IT-продукта не собираются — они в skipped с причиной.',
    permission: 'WRITE',
    body: generateDocumentsSchema,
    bodyOptional: true,
    errors: [...WRITE_ERRORS, 'CONFLICT'],
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
      'предыдущих этапов — недопустимый переход. Пункт вуза (`isUniversityItem`, ' +
      'решение 103): при действующем представителе вуза — 403 «Этот пункт отмечает ' +
      'представитель вуза в кабинете вуза»; без представителя отметка только с ' +
      '`confirmationNote` (3–500 символов), иначе 422 по полю `confirmationNote`. ' +
      'Как сотрудник может отметить пункт — `staffMarkRule` в пункте этапа.',
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
  {
    method: 'get',
    path: '/api/analytics/stage-durations',
    tag: 'Аналитика',
    summary: 'Длительность этапов по Каплану–Мейеру и порог застоя',
    description:
      'Решение 120. По каждому этапу 1–13: n (входили в этап), events (перешли дальше), censored ' +
      '(ещё на этапе, пауза, отмена), median и p90 в днях с 95% интервалом (ci), кривая ' +
      'curve [{day, F, lo, hi}] — доля прошедших этап к дню. status insufficient_data — меньше ' +
      'minObservations наблюдений или minEvents переходов: порог застоя тогда ручной (threshold.source manual).',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/analytics/stalled-preview',
    tag: 'Аналитика',
    summary: 'Предпросмотр порога застоя: сколько связок станут или перестанут быть застрявшими',
    description:
      'Решение 120. Было (текущий порог правила) → станет (порог days) по открытым связкам, у которых ' +
      'этап stage текущий; без stage — по всем этапам. Ничего не меняет.',
    permission: 'ANALYTICS',
    query: stalledPreviewQuerySchema,
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: '/api/analytics/funnel',
    tag: 'Аналитика',
    summary: 'Воронка по этапам или вехам с отвалившимися и разрезом',
    description:
      'Решение 120. Для каждого шага: дошли, конверсия от предыдущего и от начала, медиана дней ' +
      'перехода, в работе, отвалившиеся (отменены или на паузе) со ссылками. milestones=true — ' +
      'шесть вех вместо 14 этапов; groupBy — разрез.',
    permission: 'ANALYTICS',
    query: funnelQuerySchema,
    errors: [...COMMON_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: '/api/analytics/cohorts',
    tag: 'Аналитика',
    summary: 'Когорты: квартал старта × кварталы с начала → доля с подписанным договором',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/analytics/insights',
    tag: 'Аналитика',
    summary: '«Система заметила»: отклонения рядов и выводы по этапам',
    description:
      'Решение 120. [{code, severity, title, detail, facts, link}] — детерминированные тексты по ' +
      'шаблонам, каждое число из текста есть в facts. Без ИИ.',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
  },

  // ── Рекомендации ──────────────────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/recommendations/generate',
    tag: 'Рекомендации',
    summary: 'Пересобрать рекомендации по правилам',
    description:
      'Не плодит дубликаты. Открытые, чья проблема ушла, закрывает; закрытые, чья проблема ' +
      'вернулась, открывает; отклонённые с основанием не трогает, пока идёт пауза после ' +
      'отклонения (решение 119, 30 дней). Пересчитывает балл открытых рекомендаций.',
    permission: 'ANALYTICS_WORK',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/recommendations',
    tag: 'Рекомендации',
    summary: 'Список рекомендаций',
    description:
      'sort=-score — по баллу (решение 119): польза правила по решениям сотрудников, ценность ' +
      'случая и приоритет; отложенные защитой от перегрузки — в конце. У каждой записи score, ' +
      'scoreBreakdown (почему выше), reasons (почему предложена) и isDeferred. deferred=false — без отложенных.',
    permission: 'ANALYTICS',
    query: recommendationListQuerySchema,
    list: true,
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/recommendations/why-not',
    tag: 'Рекомендации',
    summary: 'Почему по объекту нет рекомендации',
    description:
      'Решение 119. Прогоняет по программе, связке или навыку те же проверки, что правило при ' +
      'пересборке, и возвращает каждую: пройдена ли и почему (уже есть сотрудничество, спрос ниже ' +
      'порога, отклонена N дней назад — пауза до даты, правило выключено).',
    permission: 'ANALYTICS',
    query: whyNotQuerySchema,
    errors: [...READ_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: '/api/recommendations/rules/stats',
    tag: 'Рекомендации',
    summary: 'Вес каждого правила рекомендаций',
    description:
      'Решение 119. Вероятность, что рекомендация правила окажется полезной (среднее Beta по ' +
      'счётчикам с затуханием), 90-процентный интервал, полные и эффективные показы и успехи — ' +
      'общий уровень, вузы и менеджеры.',
    permission: 'ANALYTICS',
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
    summary: 'Принять, взять в работу, закрыть или отклонить рекомендацию',
    description:
      'Переходы — по RECOMMENDATION_TRANSITIONS (иначе INVALID_TRANSITION). Закрыть рекомендацию ' +
      'о просрочке, застое, невыбранном продукте или недостающих показателях можно, только когда ' +
      'условие ушло (иначе CONFLICT). Отклонение требует комментария с основанием.',
    permission: 'ANALYTICS_WORK',
    body: updateRecommendationSchema,
    errors: [...WRITE_ERRORS, 'INVALID_TRANSITION', 'CONFLICT'],
  },

  // ── ИИ-помощник (решение 90) ──────────────────────────────────────────────
  {
    method: 'post',
    path: '/api/cooperations/{id}/ai-summary',
    tag: 'ИИ-помощник',
    summary: 'Сводка по связке: где она, что мешает, что сделать дальше',
    description:
      'Черновик текста. Факты — из карточки связки и её открытых рекомендаций, без персональных ' +
      'данных; модель (YandexGPT или GigaChat) только формулирует. Модель выключена ' +
      '(AI_ASSIST_PROVIDER=off, по умолчанию), не настроена, упала, не уложилась в таймаут ' +
      'или лимит — тот же текст шаблоном, source: "template". Тело не нужно.',
    permission: 'ANALYTICS',
    returnsOk: true,
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/recommendations/{id}/ai-letter',
    tag: 'ИИ-помощник',
    summary: 'Черновик письма вузу по рекомендации',
    description:
      'Вежливое деловое письмо от лица ИТ-Школы РТК по фактам рекомендации: что нужно от вуза ' +
      'и к какому сроку. Письмо не отправляется. Без модели — шаблон. Тело не нужно.',
    permission: 'WRITE',
    returnsOk: true,
    errors: READ_ERRORS,
  },
  {
    method: 'post',
    path: '/api/ai/today',
    tag: 'ИИ-помощник',
    summary: 'Что сделать сегодня: 3–7 дел текущего пользователя',
    description:
      'Открытые рекомендации и проблемные этапы связок пользователя; порядок задают правила ' +
      'рекомендаций, модель только формулирует. Без модели — шаблон. Тело не нужно.',
    permission: 'ANALYTICS',
    returnsOk: true,
    errors: COMMON_ERRORS,
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
    permission: 'UNIVERSITY_PORTAL_WRITE',
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
    permission: 'UNIVERSITY_PORTAL_WRITE',
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
    permission: 'UNIVERSITY_PORTAL_WRITE',
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
    permission: 'ANALYTICS_WORK',
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
    path: '/api/settings/parameters',
    tag: 'Настройки',
    summary: 'Параметры расчётов: веса, пороги, нормативы',
    description:
      'Только чтение (решение 107). Значения берутся из тех же констант, по которым считает код; ' +
      'isTemporary — рабочее значение (TEMP), утверждается с заказчиком. Группы: рейтинг, дефициты, ' +
      'профиль навыков, нормативы 14 этапов, правила рекомендаций, вход, сроки хранения; ' +
      'у каждой — ссылка на раздел методики.',
    permission: 'ANALYTICS',
    errors: COMMON_ERRORS,
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
  {
    method: 'get',
    path: '/api/audit/verify',
    tag: 'Журнал',
    summary: 'Проверка целостности журнала: цепочка хешей и печати',
    description:
      'Решение 115. Проверяет цепочку хешей журнала двумя независимыми путями (функцией в базе ' +
      'и кодом приложения) и сверяет её с сохранёнными печатями. Ответ 200 и при нарушении: ' +
      'ok=false, code, brokenAt, reason. Факт проверки пишется в журнал (audit.verify).',
    permission: 'ADMIN',
    errors: COMMON_ERRORS,
  },
  {
    method: 'get',
    path: '/api/audit/seals',
    tag: 'Журнал',
    summary: 'Печати журнала: голова цепочки на момент снятия',
    description:
      'Решение 115. Новые сверху. Печать снимает npm run audit:seal по расписанию; ' +
      'её копия вне базы ловит удаление хвоста журнала.',
    permission: 'ADMIN',
    query: paginationSchema,
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
