import type { AuditEntry } from '@/shared/audit/audit'
import type { ThrottleTrigger } from './throttle'

/**
 * Записи журнала действий о входе.
 *
 * Что пишется: кто (если учётная запись существует), с какого адреса, чем кончилось.
 * Что не пишется никогда: пароль и введённый адрес почты. Пароль понятно почему;
 * почту — потому что в поле почты по ошибке вводят пароль, и журнал начал бы
 * хранить пароли открытым текстом. Несуществующая учётная запись пишется как
 * `unknown`: для разбора перебора хватает адреса клиента и времени.
 *
 * Отбитые попытки во время блокировки не пишутся: иначе перебор превращал бы
 * каждый запрос в запись в базу — ровно то, от чего блокировка защищает.
 * Сама блокировка пишется один раз, в момент, когда она наступила.
 */
export type LoginOutcome =
  | {
      kind: 'success'
      userId: string
      address: string
      /**
       * Вход кнопкой быстрого входа эксперта (решение 176), а не паролем.
       * Необязательное поле: обычный вход его не передаёт, и запись журнала
       * не меняется — только у быстрого входа в payload добавляется пометка.
       */
      quickLogin?: boolean
    }
  | { kind: 'failure'; userId: string | null; address: string; triggered: ThrottleTrigger[] }

/** Объект записи о неизвестной учётной записи. */
export const UNKNOWN_ACCOUNT = 'unknown'

export function loginAuditEntries(outcome: LoginOutcome): AuditEntry[] {
  if (outcome.kind === 'success') {
    return [
      {
        userId: outcome.userId,
        action: 'auth.login.success',
        objectType: 'User',
        objectId: outcome.userId,
        payload: outcome.quickLogin
          ? { address: outcome.address, quickLogin: true }
          : { address: outcome.address },
      },
    ]
  }

  const target = {
    userId: outcome.userId,
    objectType: 'User',
    objectId: outcome.userId ?? UNKNOWN_ACCOUNT,
  }
  const entries: AuditEntry[] = [
    {
      ...target,
      action: 'auth.login.failure',
      payload: { address: outcome.address, knownAccount: outcome.userId !== null },
    },
  ]
  if (outcome.triggered.length > 0) {
    entries.push({
      ...target,
      action: 'auth.login.blocked',
      payload: { address: outcome.address, counters: outcome.triggered },
    })
  }
  return entries
}
