import { randomInt } from 'node:crypto'
import { PASSWORD_POLICY } from '@/shared/config/auth.config'
import { canBeResponsible, type UserRole } from '@/shared/contracts/enums'
import { conflict, validationError } from '@/shared/http/errors'
import { plural } from '@/shared/utils/text'

/**
 * Правила управления пользователями и паролями.
 *
 * Чистые функции без базы: сервис собирает факты (кто действует, кого меняют,
 * сколько останется администраторов, сколько за человеком открытой работы),
 * а решение принимается здесь — и проверяется тестами без базы.
 */

// ── Временный пароль ────────────────────────────────────────────────────────

/**
 * Алфавит временного пароля: латиница и цифры без похожих знаков — нет
 * `0`/`O`/`o`, `1`/`l`/`I`/`i`. Пароль диктуют голосом или переписывают
 * с листка, и «l или I?» стоило бы человеку трёх неудачных входов.
 */
export const TEMPORARY_PASSWORD_ALPHABET = {
  upper: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  lower: 'abcdefghjkmnpqrstuvwxyz',
  digits: '23456789',
} as const

const FULL_ALPHABET =
  TEMPORARY_PASSWORD_ALPHABET.upper + TEMPORARY_PASSWORD_ALPHABET.lower + TEMPORARY_PASSWORD_ALPHABET.digits

/** Источник случайности: `crypto.randomInt` — криптостойкий. В тестах подменяется. */
export type RandomIndex = (max: number) => number

/**
 * Временный пароль от администратора.
 *
 * Каждый знак — независимый криптостойкий выбор из 54 знаков: 14 знаков дают
 * около 80 бит. В пароле есть заглавная, строчная и цифра — иначе он не прошёл бы
 * политику паролей, если её когда-нибудь ужесточат; такой набор просто
 * перевыбирается (случается редко и не смещает распределение остальных).
 */
export function generateTemporaryPassword(
  random: RandomIndex = (max) => randomInt(max),
  length: number = PASSWORD_POLICY.temporaryLength,
): string {
  for (;;) {
    let password = ''
    for (let index = 0; index < length; index += 1) {
      password += FULL_ALPHABET[random(FULL_ALPHABET.length)]
    }
    const complete = Object.values(TEMPORARY_PASSWORD_ALPHABET).every((group) =>
      [...password].some((char) => group.includes(char)),
    )
    if (complete) return password
  }
}

// ── Новый пароль, который человек задаёт себе сам ──────────────────────────

/**
 * Что не так с новым паролем, или null, если всё в порядке.
 *
 * Не короче `PASSWORD_POLICY.minLength`, не длиннее 72 байт (дальше bcrypt не
 * читает), не совпадает с текущим и с почтой — почта видна коллегам в справочнике,
 * и пароль, равный ей, подбирается первым.
 */
export function newPasswordProblem(
  newPassword: string,
  context: { currentPassword: string; email: string },
): string | null {
  if ([...newPassword].length < PASSWORD_POLICY.minLength) {
    return `Пароль должен быть не короче ${PASSWORD_POLICY.minLength} символов`
  }
  if (new TextEncoder().encode(newPassword).length > PASSWORD_POLICY.maxBytes) {
    return 'Пароль слишком длинный: система учитывает только первые 72 байта (около 36 русских букв или 72 латинских)'
  }
  if (newPassword.trim() === '') return 'Пароль не может состоять из одних пробелов'
  if (newPassword === context.currentPassword) return 'Новый пароль совпадает с текущим'
  if (newPassword.trim().toLowerCase() === context.email.trim().toLowerCase()) {
    return 'Пароль не должен совпадать с адресом почты'
  }
  return null
}

// ── Роль и вуз ──────────────────────────────────────────────────────────────

export interface RoleAssignment {
  role: UserRole
  universityId: string | null
}

/**
 * Итоговые роль и вуз после изменения.
 *
 * Вуз обязателен у представителя вуза и запрещён у остальных: по нему
 * ограничивается видимость (то же правило сверяет `npm run db:verify`). Если роль меняется с представителя
 * на другую и вуз не передан, он снимается сам: требовать от администратора
 * явного `universityId: null` незачем. Переданный вуз у другой роли — ошибка,
 * а не молчаливое удаление: скорее всего, выбрана не та роль.
 */
export function resolveRoleAssignment(
  current: RoleAssignment | null,
  input: { role?: UserRole; universityId?: string | null },
): RoleAssignment {
  const role = input.role ?? current?.role
  if (!role) {
    throw validationError('Не указана роль', [{ field: 'role', message: 'Выберите роль' }])
  }

  if (role === 'UNIVERSITY_REP') {
    const universityId =
      input.universityId !== undefined ? input.universityId : (current?.universityId ?? null)
    if (!universityId) {
      throw validationError('У представителя вуза должен быть вуз', [
        { field: 'universityId', message: 'Выберите вуз представителя' },
      ])
    }
    return { role, universityId }
  }

  if (input.universityId) {
    throw validationError('Вуз указывается только у представителя вуза', [
      {
        field: 'universityId',
        message: 'Сотруднику ИТ-Школы вуз не назначается — уберите его или выберите роль «Представитель вуза»',
      },
    ])
  }
  return { role, universityId: null }
}

// ── Защиты при изменении ────────────────────────────────────────────────────

export interface UserChangeFacts {
  /** Кто действует. */
  actorId: string
  target: { id: string; role: UserRole; isActive: boolean }
  next: { role: UserRole; isActive: boolean }
  /** Сколько действующих администраторов, кроме изменяемого. */
  otherActiveAdmins: number
  /** Открытая работа изменяемого: связки и этапы, где он ответственный. */
  openWork: { cooperations: number; stages: number }
}

/**
 * Проверяет изменение роли и доступа. Нарушение — CONFLICT 409 с объяснением.
 *
 * - себя нельзя заблокировать и нельзя снять с себя роль администратора:
 *   иначе единственный администратор одним щелчком запер бы систему, а если
 *   их несколько — потерял бы доступ посреди работы без возможности вернуть;
 * - нельзя оставить систему без действующего администратора — некому будет
 *   завести пользователя и разблокировать учётную запись;
 * - менеджера с открытыми связками или этапами нельзя перевести в роль, которой
 *   ответственным быть нельзя (RESPONSIBLE_ROLES): связки остались бы за тем,
 *   кто не может их вести. Блокировать такого можно — это решение
 *   администратора, интерфейс лишь предупреждает, сколько работы останется.
 */
export function assertUserChangeAllowed(facts: UserChangeFacts): void {
  const { actorId, target, next } = facts
  const isSelf = actorId === target.id

  if (isSelf && target.isActive && !next.isActive) {
    throw conflict('Нельзя заблокировать собственную учётную запись')
  }
  if (isSelf && target.role === 'ADMIN' && next.role !== 'ADMIN') {
    throw conflict('Нельзя снять роль администратора с самого себя: это сделает другой администратор')
  }

  const wasActiveAdmin = target.role === 'ADMIN' && target.isActive
  const staysActiveAdmin = next.role === 'ADMIN' && next.isActive
  if (wasActiveAdmin && !staysActiveAdmin && facts.otherActiveAdmins === 0) {
    throw conflict(
      'Это последний действующий администратор: без него некому управлять пользователями. Сначала назначьте другого администратора',
    )
  }

  const { cooperations, stages } = facts.openWork
  if (
    target.role !== next.role &&
    canBeResponsible(target.role) &&
    !canBeResponsible(next.role) &&
    cooperations + stages > 0
  ) {
    throw conflict(
      `Сначала передайте связки: сотрудник отвечает за ${describeOpenWork(facts.openWork)}. ` +
        'Ответственным может быть только менеджер или администратор',
      { openCooperations: cooperations, openStages: stages },
    )
  }
}

/** «2 открытые связки и 5 этапов» — для текста отказа и предупреждения. */
export function describeOpenWork(openWork: { cooperations: number; stages: number }): string {
  const parts: string[] = []
  if (openWork.cooperations > 0) {
    parts.push(`${openWork.cooperations} ${plural(openWork.cooperations, ['открытую связку', 'открытые связки', 'открытых связок'])}`)
  }
  if (openWork.stages > 0) {
    parts.push(`${openWork.stages} ${plural(openWork.stages, ['незакрытый этап', 'незакрытых этапа', 'незакрытых этапов'])}`)
  }
  return parts.length > 0 ? parts.join(' и ') : 'ничего'
}

/**
 * Какие записи журнала даёт изменение пользователя.
 *
 * Роль, блокировка и разблокировка — отдельными действиями (их ищут по коду
 * в фильтре журнала); ФИО, должность и вуз — одним `user.update` с именами
 * полей, без значений: это персональные данные.
 */
export function userChangeAuditActions(
  before: { role: UserRole; isActive: boolean; universityId: string | null; fullName: string; position: string | null },
  after: { role: UserRole; isActive: boolean; universityId: string | null; fullName: string; position: string | null },
): Array<
  | { action: 'user.role.change'; payload: { from: UserRole; to: UserRole } }
  | { action: 'user.block' | 'user.unblock'; payload?: undefined }
  | { action: 'user.update'; payload: { fields: string[] } }
> {
  const entries: ReturnType<typeof userChangeAuditActions> = []
  if (before.role !== after.role) {
    entries.push({ action: 'user.role.change', payload: { from: before.role, to: after.role } })
  }
  if (before.isActive && !after.isActive) entries.push({ action: 'user.block' })
  if (!before.isActive && after.isActive) entries.push({ action: 'user.unblock' })

  const fields = (['fullName', 'position', 'universityId'] as const).filter(
    (field) => before[field] !== after[field],
  )
  if (fields.length > 0) entries.push({ action: 'user.update', payload: { fields } })
  return entries
}
