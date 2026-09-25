/**
 * Правила отбора для сроков хранения журнала действий (docs/PRIVACY.md).
 *
 * Чистые функции: что удалить и где стереть адрес клиента, решается здесь,
 * а scripts/retention.ts только читает базу и применяет решение. Так правило
 * проверяется тестом без базы.
 */

/** Ключ `payload`, в котором журнал хранит адрес клиента (вход, выгрузка). */
export const CLIENT_ADDRESS_KEY = 'address'

export interface RetentionPolicy {
  /** Сколько дней хранится запись журнала. */
  auditLogDays: number
  /** Сколько дней хранится адрес клиента в записи. */
  clientAddressDays: number
}

export interface RetentionCutoffs {
  /** Записи, созданные раньше, удаляются. */
  deleteBefore: Date
  /** В записях, созданных раньше, стирается адрес клиента. */
  stripAddressBefore: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Границы по сроку. Срок — целое положительное число дней: ноль или дробь
 * в настройке означали бы «удалить весь журнал», и такое не должно пройти молча.
 */
export function retentionCutoffs(now: Date, policy: RetentionPolicy): RetentionCutoffs {
  for (const [name, days] of Object.entries(policy)) {
    if (!Number.isInteger(days) || days < 1) {
      throw new Error(`Срок хранения ${name} должен быть целым числом дней не меньше 1, а не ${days}`)
    }
  }
  return {
    deleteBefore: new Date(now.getTime() - policy.auditLogDays * DAY_MS),
    stripAddressBefore: new Date(now.getTime() - policy.clientAddressDays * DAY_MS),
  }
}

/** В записи есть адрес клиента, который ещё не стёрт. `unknown` — тоже адрес: его стирают так же. */
export function hasClientAddress(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  const value = (payload as Record<string, unknown>)[CLIENT_ADDRESS_KEY]
  return typeof value === 'string'
}

/**
 * Запись без адреса клиента. Ключ остаётся со значением null — так в журнале видно,
 * что адрес был и стёрт по сроку, а не что его не записали.
 */
export function stripClientAddress(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, [CLIENT_ADDRESS_KEY]: null }
}

export interface RetentionRow {
  id: string
  createdAt: Date
  payload: unknown
}

export interface RetentionPlan {
  /** Удалить целиком: старше срока хранения журнала. */
  deleteIds: string[]
  /** Стереть адрес клиента: старше срока хранения адреса, но ещё не к удалению. */
  stripIds: string[]
}

/**
 * Что сделать с набором записей. Запись к удалению адрес не стирает — она уходит
 * целиком; запись без адреса не трогается; свежая запись не трогается вовсе.
 */
export function planRetention(rows: readonly RetentionRow[], cutoffs: RetentionCutoffs): RetentionPlan {
  const plan: RetentionPlan = { deleteIds: [], stripIds: [] }
  for (const row of rows) {
    if (row.createdAt < cutoffs.deleteBefore) plan.deleteIds.push(row.id)
    else if (row.createdAt < cutoffs.stripAddressBefore && hasClientAddress(row.payload)) {
      plan.stripIds.push(row.id)
    }
  }
  return plan
}
