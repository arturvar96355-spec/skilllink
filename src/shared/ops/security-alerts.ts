import { prisma } from '@/shared/db/prisma'
import { OWNER_ALERT_BURSTS } from '@/shared/config/ops.config'
import { BurstCounter, notifyOwner, type OwnerAlertPayload } from './owner-alert'

/**
 * Когда именно приложение зовёт владельца (решение 118). Каждая функция — одна
 * строка в месте события; сами решения «массово ли это» и «новый ли адрес» — здесь,
 * чтобы вход, управление пользователями и выгрузка не обрастали логикой оповещений.
 *
 * Ничего здесь не бросает и не задерживает основную операцию.
 */

type Notify = (event: Parameters<typeof notifyOwner>[0], payload?: OwnerAlertPayload) => void

let notify: Notify = notifyOwner

/** Только для тестов: подменить отправку. */
export function setSecurityAlertSink(sink: Notify | null): void {
  notify = sink ?? notifyOwner
}

const captchaBursts = new BurstCounter(OWNER_ALERT_BURSTS.captcha.windowMs)
const exportBursts = new BurstCounter(OWNER_ALERT_BURSTS.exportsPerUser.windowMs)

/** Только для тестов. */
export function resetSecurityAlerts(): void {
  captchaBursts.reset()
  exportBursts.reset()
}

/**
 * Неудачная попытка закрыла вход (throttle.ts). Одна блокировка учётной записи —
 * одно сообщение за 15 минут, как бы ни продолжался перебор; перебор по многим
 * учётным записям с одного адреса — одно сообщение на адрес.
 */
export function alertLoginBlocked(account: string, address: string, counters: readonly string[]): void {
  if (counters.length === 0) return
  const byAddress = counters.includes('address')
  notify('login.blocked', {
    key: byAddress ? `address:${address}` : `account:${account}`,
    details: { account, address, counters },
  })
}

/**
 * Вход потребовал проверку «не робот» (решение 100). Одиночная — обычная опечатка;
 * порог за окно по всей системе — похоже на перебор с многих адресов.
 */
export function noteCaptchaRequired(now = Date.now()): void {
  const { threshold, windowMs } = OWNER_ALERT_BURSTS.captcha
  const count = captchaBursts.hit('all', now)
  if (count >= threshold) {
    notify('login.captcha-burst', { details: { count, windowMinutes: Math.round(windowMs / 60_000) } })
  }
}

/**
 * Администратор вошёл с адреса, с которого раньше не входил. Сверка — по журналу
 * действий (`auth.login.success`, адрес в payload) до момента этого входа. Адрес
 * в журнале хранится 90 дней (PRIVACY.md) — после этого адрес снова «новый».
 *
 * Запрос идёт после ответа на вход и в фоне: вход не ждёт ни базы, ни Telegram.
 */
export function alertAdminLogin(userId: string, address: string, loginAt: Date): void {
  if (address === 'unknown') return
  void (async () => {
    try {
      const seen = await prisma.auditLog.findFirst({
        where: {
          userId,
          action: 'auth.login.success',
          createdAt: { lt: loginAt },
          payload: { path: ['address'], equals: address },
        },
        select: { id: true },
      })
      if (!seen) notify('admin.login.new-address', { key: `${userId}:${address}`, details: { userId, address } })
    } catch {
      // Журнал недоступен — не повод ни ломать вход, ни звать владельца.
    }
  })()
}

/** Пользователь заблокирован или получил роль администратора (управление пользователями). */
export function alertUserChange(
  actorId: string,
  userId: string,
  before: { role: string; isActive: boolean } | null,
  after: { role: string; isActive: boolean },
): void {
  if (before?.isActive && !after.isActive) {
    notify('user.blocked', { key: userId, details: { userId, by: actorId } })
  }
  if (after.role === 'ADMIN' && before?.role !== 'ADMIN') {
    notify('user.role.admin', {
      key: userId,
      details: { userId, from: before ? before.role : 'новая учётная запись', by: actorId },
    })
  }
}

/** Выгрузка файла: порог выгрузок одного пользователя за окно — массовая. */
export function noteExport(userId: string, dataset: string, rows: number, now = Date.now()): void {
  const { threshold, windowMs } = OWNER_ALERT_BURSTS.exportsPerUser
  const count = exportBursts.hit(userId, now)
  if (count >= threshold) {
    notify('export.bulk', {
      key: userId,
      details: { userId, count, windowMinutes: Math.round(windowMs / 60_000), dataset, rows },
    })
  }
}
