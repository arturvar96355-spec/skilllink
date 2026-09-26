import { compare, hash } from 'bcryptjs'
import { pageMeta } from '@/shared/http/pagination'
import { conflict, forbidden, notFound, validationError } from '@/shared/http/errors'
import { can, assertCan, isReviewerAllowed, type Permission } from '@/shared/auth/permissions'
import { checkLogin, releaseAccount, throttledAttempt, type LoginSource } from '@/shared/auth/throttle'
import { writeAudit } from '@/shared/audit/audit'
import { alertUserChange } from '@/shared/ops/security-alerts'
import {
  PASSWORD_POLICY,
  SHARED_DEMO_ACCOUNT_REFUSAL,
  isSharedDemoAccount,
} from '@/shared/config/auth.config'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { PageMeta } from '@/shared/contracts/common'
import type {
  CurrentUserDto,
  IssuedPasswordDto,
  ManagedUserDto,
  PasswordChangedDto,
  UserDto,
} from '@/shared/contracts/user'
import { toIsoRequired } from '@/shared/utils/date'
import * as calendarRepo from '@/modules/calendar/calendar.repo'
import { approvalRequiredError, requireApproval } from '@/modules/approvals/approvals.service'
import { userChangeApprovals } from '@/modules/approvals/approvals.rules'
import { approvalsRequired } from '@/shared/config/approvals.config'
import * as telegramRepo from '@/modules/telegram/telegram.repo'
import * as notifyChannelsRepo from '@/modules/notify-channels/notify-channels.repo'
import * as repo from './auth.repo'
import {
  assertUserChangeAllowed,
  generateTemporaryPassword,
  newPasswordProblem,
  resolveRoleAssignment,
  revokesSessions,
  userChangeAuditActions,
} from './auth.rules'
import type {
  ChangePasswordInput,
  CreateUserInput,
  UpdateUserInput,
  UserListQuery,
} from './auth.schema'

/**
 * Почту в справочнике видят только те, кто назначает ответственных и ведёт
 * переписку, — ADMIN и MANAGER (право WRITE). Аналитику и наблюдателю справочник
 * нужен, чтобы видеть, кто за что отвечает, а список рабочих адресов всех
 * сотрудников и представителей вузов — это персональные данные сверх нужного.
 */
export function canSeeUserEmails(user: CurrentUser): boolean {
  return can(user, 'WRITE')
}

export function toUserDto(row: repo.UserRow, showEmail: boolean): UserDto {
  return {
    id: row.id,
    email: showEmail ? row.email : null,
    fullName: row.fullName,
    position: row.position,
    role: row.role,
    universityId: row.universityId,
    universityName: row.university?.name ?? null,
    isActive: row.isActive,
  }
}

/**
 * Справочник пользователей: нужен для выбора ответственного и участников встреч.
 * Представителю вуза он недоступен — состав сотрудников ИТ-Школы его не касается.
 */
export async function listUsers(
  user: CurrentUser,
  query: UserListQuery,
): Promise<{ data: UserDto[]; meta: PageMeta }> {
  assertCan(user, 'ANALYTICS')

  const showEmail = canSeeUserEmails(user)
  // Поиск по почте — тоже только тем, кому её показывают: иначе адрес
  // восстанавливался бы подбором строки поиска по одной букве.
  const { rows, total } = await repo.findMany(query, { searchEmail: showEmail })
  return {
    data: rows.map((row) => toUserDto(row, showEmail)),
    meta: pageMeta({ page: query.page, pageSize: query.pageSize }, total),
  }
}

/**
 * Должность и вуз не входят в объект текущего пользователя: он проходит через
 * каждую проверку прав, и тащить туда поля для шапки незачем. Их дочитывает
 * `currentUserProfile` — один запрос на открытие страницы.
 */
export interface CurrentUserProfile {
  position: string | null
  universityName: string | null
  /** Действующий пароль выдан администратором (по журналу действий). */
  passwordTemporary?: boolean
}

/** Текущий пользователь и его права: фронт по ним решает, что показывать. */
export function describeCurrentUser(
  user: CurrentUser,
  profile: CurrentUserProfile = { position: null, universityName: null },
): CurrentUserDto {
  // Эксперт хакатона (решение 147): флаги прав для экрана — те же, что пропустит
  // assertCan. Кнопки изменения ему не показываются, а не только отклоняются сервером.
  const allowed = (permission: Permission): boolean => can(user, permission) && (!user.isReviewer || isReviewerAllowed(permission))
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    position: profile.position,
    role: user.role,
    universityId: user.universityId,
    universityName: profile.universityName,
    isReviewer: user.isReviewer ?? false,
    permissions: {
      canWrite: allowed('WRITE'),
      canSeeAnalytics: allowed('ANALYTICS'),
      canWorkAnalytics: allowed('ANALYTICS_WORK'),
      canUsePortal: allowed('UNIVERSITY_PORTAL'),
      canWritePortal: allowed('UNIVERSITY_PORTAL_WRITE'),
      canSeeContactDetails: allowed('CONTACT_DETAILS'),
      isAdmin: allowed('ADMIN'),
      canAssignResponsible: allowed('ASSIGN_RESPONSIBLE'),
      canReviewLetters: allowed('INBOUND_REVIEW'),
    },
    passwordTemporary: profile.passwordTemporary ?? false,
  }
}

/** Текущий пользователь с профилем — ответ `GET /api/me`. */
export async function currentUserProfile(user: CurrentUser): Promise<CurrentUserDto> {
  const [profile, lastPasswordEvent] = await Promise.all([
    repo.findProfile(user.id),
    repo.findLastPasswordEvent(user.id),
  ])
  return describeCurrentUser(user, {
    position: profile?.position ?? null,
    universityName: profile?.university?.name ?? null,
    passwordTemporary: isTemporaryPassword(lastPasswordEvent),
  })
}

/**
 * Временный ли пароль сейчас — по последнему событию пароля в журнале.
 * Заведение и сброс выдают временный, смена самим пользователем — свой.
 * Событий нет (демо-пользователи из seed) — пароль не считается временным.
 */
export function isTemporaryPassword(lastPasswordEvent: string | null): boolean {
  return lastPasswordEvent === 'user.create' || lastPasswordEvent === 'user.password.reset'
}

// ── Управление пользователями (право ADMIN) ─────────────────────────────────

/**
 * Хеш нового пароля. bcrypt — как у входа (auth.ts) и демо-данных; соль внутри хеша.
 * Пароль нигде не сохраняется и не пишется в журнал — только этот хеш в базу.
 */
function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_POLICY.hashRounds)
}

async function assertUniversityForRep(universityId: string | null): Promise<void> {
  if (!universityId) return
  const university = await repo.findUniversity(universityId)
  if (!university) {
    throw validationError('Вуз не найден', [{ field: 'universityId', message: 'Вуз не найден' }])
  }
  if (university.archivedAt) {
    throw validationError('Вуз в архиве', [
      { field: 'universityId', message: 'Вуз в архиве: представителя к нему не привязать' },
    ])
  }
}

/** Карточка пользователя для администратора: с открытой работой — для предупреждения о блокировке. */
export async function getManagedUser(user: CurrentUser, id: string): Promise<ManagedUserDto> {
  assertCan(user, 'ADMIN')
  const row = await repo.findById(id)
  if (!row) throw notFound('Пользователь не найден')
  const openWork = await repo.countOpenWork(id)
  return {
    ...toUserDto(row, true),
    email: row.email,
    openCooperations: openWork.cooperations,
    openStages: openWork.stages,
    createdAt: toIsoRequired(row.createdAt),
  }
}

/**
 * Заведение пользователя. Пароль — временный, его генерирует сервер и отдаёт
 * **один раз** в ответе; в базе остаётся только хеш.
 */
export async function createUser(user: CurrentUser, input: CreateUserInput): Promise<IssuedPasswordDto> {
  assertCan(user, 'ADMIN')

  const assignment = resolveRoleAssignment(null, input)
  await assertUniversityForRep(assignment.universityId)
  // «Четыре глаза» (решение 133): одобрение выдаётся на существующего пользователя,
  // поэтому администратора заводят в два шага — с другой ролью, затем назначают.
  if (assignment.role === 'ADMIN' && approvalsRequired()) {
    throw approvalRequiredError(
      'user.grant_admin',
      'Администратора заводят в два шага: заведите пользователя с другой ролью, затем назначьте администратором с одобрением второго администратора',
    )
  }

  if (await repo.findByEmail(input.email)) {
    throw conflict('Пользователь с такой почтой уже есть', [
      { field: 'email', message: 'Эта почта уже занята другой учётной записью' },
    ])
  }

  const temporaryPassword = generateTemporaryPassword()
  const row = await repo.createUser({
    email: input.email,
    fullName: input.fullName,
    position: input.position ?? null,
    ...assignment,
    passwordHash: await hashPassword(temporaryPassword),
  })

  // Без почты и ФИО — это персональные данные; кто заведён, видно по objectId.
  await writeAudit({
    userId: user.id,
    action: 'user.create',
    objectType: 'User',
    objectId: row.id,
    payload: { role: row.role, universityId: row.universityId },
  })
  alertUserChange(user.id, row.id, null, { role: row.role, isActive: true })

  return { user: toUserDto(row, true), temporaryPassword }
}

/**
 * Изменение пользователя: ФИО, должность, роль с вузом, блокировка.
 *
 * Проверки (auth.rules.ts) идут внутри транзакции с блокировкой строк
 * администраторов: «последний администратор» не обходится двумя одновременными
 * запросами. Блокировка действует сразу: `getCurrentUser()` читает пользователя
 * из базы с `isActive: true` на каждый запрос, поэтому уже выданная сессия
 * заблокированного перестаёт работать со следующего запроса.
 *
 * Блокировка и смена роли увеличивают версию сессий (решение 109): выданные раньше
 * сессии не оживают и после разблокировки — войти придётся заново. Блокировка
 * в той же транзакции отзывает подписку на календарь: ссылка — тоже доступ,
 * и после разблокировки её надо выпустить заново.
 */
export async function updateUser(user: CurrentUser, id: string, input: UpdateUserInput): Promise<UserDto> {
  assertCan(user, 'ADMIN')

  // Вуз проверяется до транзакции: чтение справочника не требует блокировок.
  if (input.universityId) await assertUniversityForRep(input.universityId)

  const result = await repo.updateWithGuard(id, ({ target, otherActiveAdmins, openWork }) => {
    if (isSharedDemoAccount(target.email)) throw conflict(SHARED_DEMO_ACCOUNT_REFUSAL)
    const assignment = resolveRoleAssignment(target, input)
    const nextIsActive = input.isActive ?? target.isActive
    assertUserChangeAllowed({
      actorId: user.id,
      target: { id: target.id, role: target.role, isActive: target.isActive },
      next: { role: assignment.role, isActive: nextIsActive },
      otherActiveAdmins,
      openWork,
    })
    return {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      role: assignment.role,
      university: assignment.universityId
        ? { connect: { id: assignment.universityId } }
        : { disconnect: true },
      isActive: nextIsActive,
      ...(revokesSessions(target, { role: assignment.role, isActive: nextIsActive })
        ? { sessionVersion: { increment: 1 } }
        : {}),
    }
  }, async (tx, { before, after }) => {
    // «Четыре глаза» (решение 133): назначение администратором и блокировка
    // администратора — только по одобрению другого администратора, если оно
    // включено. В той же транзакции: не подошло одобрение — изменение откатится.
    for (const action of userChangeApprovals(before, after)) {
      await requireApproval(action, { userId: id }, { actor: user, approvalId: input.approvalId }, tx)
    }
    if (!(before.isActive && !after.isActive)) return
    // Всё, что работает без сессии, закрывается при блокировке: лента календаря
    // и сводки в Telegram, MAX, VK (решения 105, 102, 144).
    if (await telegramRepo.unlinkUser(id, tx)) {
      await writeAudit(
        { userId: user.id, action: 'telegram.unlink', objectType: 'User', objectId: id, payload: { source: 'user.block' } },
        tx,
      )
    }
    for (const channel of await notifyChannelsRepo.unlinkAllAltChannels(id, tx)) {
      await writeAudit(
        { userId: user.id, action: 'channel.unlink', objectType: 'User', objectId: id, payload: { channel, source: 'user.block' } },
        tx,
      )
    }
    if (await calendarRepo.remove(id, tx)) {
      await writeAudit(
        { userId: user.id, action: 'calendar.revoke', objectType: 'User', objectId: id, payload: { reason: 'user.block' } },
        tx,
      )
    }
  })
  if (!result) throw notFound('Пользователь не найден')

  for (const entry of userChangeAuditActions(result.before, result.after)) {
    await writeAudit({
      userId: user.id,
      action: entry.action,
      objectType: 'User',
      objectId: id,
      ...(entry.payload ? { payload: entry.payload } : {}),
    })
  }
  // Блокировка и выдача роли администратора — владельцу в Telegram (решение 118).
  alertUserChange(user.id, id, result.before, result.after)

  return toUserDto(result.after, true)
}

/**
 * Новый временный пароль для пользователя. Старый перестаёт подходить сразу,
 * а выданные сессии пользователя закрываются (версия сессий растёт в `setPasswordHash`).
 *
 * Свой пароль так не меняется: для этого есть смена в личном кабинете, где нужен
 * текущий пароль. Иначе чужой, севший за оставленный открытым ноутбук
 * администратора, одним щелчком получил бы его пароль.
 */
export async function resetPassword(user: CurrentUser, id: string): Promise<IssuedPasswordDto> {
  assertCan(user, 'ADMIN')
  if (id === user.id) {
    throw conflict('Свой пароль меняйте в личном кабинете: там нужен текущий пароль')
  }
  const target = await repo.findById(id)
  if (target?.email && isSharedDemoAccount(target.email)) throw conflict(SHARED_DEMO_ACCOUNT_REFUSAL)

  const temporaryPassword = generateTemporaryPassword()
  const row = await repo.setPasswordHash(id, await hashPassword(temporaryPassword))
  if (!row) throw notFound('Пользователь не найден')

  // Новый пароль обычно просят после пяти неудачных попыток — снимаем их,
  // иначе человек ещё 15 минут не вошёл бы и с новым паролем.
  releaseAccount(row.email.toLowerCase())

  await writeAudit({
    userId: user.id,
    action: 'user.password.reset',
    objectType: 'User',
    objectId: id,
  })

  return { user: toUserDto(row, true), temporaryPassword }
}

// ── Смена своего пароля (любая роль) ────────────────────────────────────────

/**
 * Смена своего пароля. Доступна любой роли, включая представителя вуза, —
 * и только для себя: идентификатор берётся из сессии, а не из запроса.
 *
 * Текущий пароль проверяется под тем же ограничением перебора, что и вход
 * (throttle.ts, счётчик «учётная запись + адрес»): иначе форма смены пароля
 * стала бы обходом этого ограничения для того, кто завладел открытой сессией.
 *
 * Все сессии пользователя закрываются (решение 109). Текущую `renewSession`
 * переоформляет на новую версию — человек, сменивший пароль, остаётся в системе;
 * не вышло — он выйдет на следующем запросе, как и остальные его сессии.
 */
export async function changeOwnPassword(
  user: CurrentUser,
  input: ChangePasswordInput,
  address: string,
  renewSession: (sessionVersion: number) => Promise<boolean> = async () => false,
): Promise<PasswordChangedDto> {
  if (isSharedDemoAccount(user.email)) throw conflict(SHARED_DEMO_ACCOUNT_REFUSAL)
  const problem = newPasswordProblem(input.newPassword, {
    currentPassword: input.currentPassword,
    email: user.email,
  })
  if (problem) {
    throw validationError(problem, [{ field: 'newPassword', message: problem }])
  }

  const source: LoginSource = { account: user.email.toLowerCase(), address }
  const attempt = await throttledAttempt(source, async () => {
    const passwordHash = await repo.findPasswordHash(user.id)
    if (!passwordHash) return null
    return (await compare(input.currentPassword, passwordHash)) ? true : null
  })

  if (attempt.blocked) {
    const minutes = Math.max(1, Math.ceil(checkLogin(source).retryAfterSeconds / 60))
    throw forbidden(
      `Слишком много неверных попыток. Смена пароля и вход закрыты ещё на ${minutes} мин.`,
    )
  }
  if (attempt.result === null) {
    throw validationError('Текущий пароль введён неверно', [
      { field: 'currentPassword', message: 'Неверный текущий пароль' },
    ])
  }

  const row = await repo.setPasswordHash(user.id, await hashPassword(input.newPassword))
  if (!row) throw notFound('Пользователь не найден')

  await writeAudit({
    userId: user.id,
    action: 'user.password.change',
    objectType: 'User',
    objectId: user.id,
  })

  return { changedAt: new Date().toISOString(), sessionRenewed: await renewSession(row.sessionVersion) }
}
