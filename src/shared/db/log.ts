/**
 * Строка для журнала о внутренней ошибке — без данных запроса.
 *
 * Сообщение Prisma повторяет весь вызов с аргументами: при неудачной записи
 * контакта в журнал попадали бы его ФИО, телефон и почта, а их туда писать
 * нельзя (CLAUDE.md, «Данные»). Причина — в последней строке сообщения,
 * её и оставляем.
 */
export function describeForLog(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (!error.name.startsWith('PrismaClient')) return error.message
  const lines = error.message.split('\n').map((line) => line.trim())
  const reason = lines.filter((line) => line !== '').at(-1) ?? ''
  const code = (error as { code?: unknown }).code
  return [error.name, typeof code === 'string' ? code : null, reason].filter(Boolean).join(': ')
}
