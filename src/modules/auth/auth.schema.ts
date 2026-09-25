import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { USER_ROLES } from '@/shared/contracts/enums'

const multi = <S extends z.ZodType>(schema: S) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]))

const booleanParam = z
  .union([z.literal('true'), z.literal('false')])
  .transform((value) => value === 'true')

export const userListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  role: multi(z.enum(USER_ROLES)).optional(),
  universityId: z.string().trim().min(1).optional(),
  includeInactive: booleanParam.optional(),
  /**
   * Только действующие (`true`) или только заблокированные (`false`) — фильтр
   * вкладки «Пользователи» (с 25.09.2026). Задан — важнее `includeInactive`.
   */
  isActive: booleanParam.optional(),
})

export type UserListQuery = z.infer<typeof userListQuerySchema>

// ── Управление пользователями (право ADMIN) ─────────────────────────────────

/**
 * Почта — логин: хранится в нижнем регистре, как её ищет вход (auth.ts).
 * Иначе заведённый «Ivanov@…» не вошёл бы ни с какой записью адреса.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Некорректный адрес электронной почты').max(200, 'Слишком длинный адрес'))

const fullNameSchema = z
  .string()
  .trim()
  .min(3, 'Укажите ФИО: не короче 3 символов')
  .max(200, 'ФИО длиннее 200 символов')

/** Должность необязательна: пустая строка — «не указана». */
const positionSchema = z
  .string()
  .trim()
  .max(200, 'Должность длиннее 200 символов')
  .transform((value) => (value === '' ? null : value))
  .nullish()

const universityIdSchema = z.string().trim().min(1).nullish()

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  position: positionSchema,
  role: z.enum(USER_ROLES),
  /** Обязателен у UNIVERSITY_REP, у остальных ролей запрещён (auth.rules.ts). */
  universityId: universityIdSchema,
})

export type CreateUserInput = z.infer<typeof createUserSchema>

/**
 * Изменение пользователя. Почта не меняется: это логин, и под ней в журнале
 * числятся прошлые входы. Пароль — отдельным действием (password-reset).
 */
export const updateUserSchema = z
  .object({
    fullName: fullNameSchema,
    position: positionSchema,
    role: z.enum(USER_ROLES),
    universityId: universityIdSchema,
    /** false — заблокировать, true — разблокировать. */
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateUserInput = z.infer<typeof updateUserSchema>

/**
 * Смена своего пароля. Правила нового пароля — в auth.rules.ts (`newPasswordProblem`):
 * им нужен текущий пароль и почта, схеме они недоступны. Повтор нового пароля
 * сверяет форма: серверу он ничего не добавляет.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль').max(200),
  newPassword: z.string().min(1, 'Введите новый пароль').max(200),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
