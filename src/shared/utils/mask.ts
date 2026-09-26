import { maskEmail } from '@/shared/log/redact'

/**
 * Маски почты и телефона для ответов API (решение 133): видно, что значение есть
 * и какого оно вида, но не само значение. Полное — только через раскрытие
 * с записью в журнал (`POST /api/contacts/:id/reveal`).
 */

/** `ivanov@univ.ru` → `i***@univ.ru`. Не похоже на почту — `***`. */
export function maskEmailForDisplay(email: string | null): string | null {
  if (email === null || email.trim() === '') return null
  const masked = maskEmail(email.trim())
  return masked === email.trim() ? '***' : masked
}

/**
 * `+7 (900) 123-45-71` → `+7******71`. Код страны и две последние цифры;
 * число звёздочек постоянное — длина номера не выдаётся.
 */
export function maskPhoneForDisplay(phone: string | null): string | null {
  if (phone === null) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return phone.trim() === '' ? null : '***'
  const russian = digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))
  const prefix = russian ? '+7' : phone.trim().startsWith('+') ? `+${digits.slice(0, 1)}` : ''
  return `${prefix}******${digits.slice(-2)}`
}
