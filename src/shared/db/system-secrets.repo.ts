import { prisma } from '@/shared/db/prisma'

/**
 * Доступ к `system_secrets` для записей вида «значение» (решение 142): токен
 * бота Telegram (зашифрованный), имя бота и режим приёма — как есть, это не
 * секреты. Запись вида «хеш» (секрет вебхука Telegram, решение 133) читает и
 * пишет `modules/telegram/telegram.repo.ts` напрямую: у неё свой смысл (сравнение,
 * а не чтение значения), и она не пересекается с этим модулем по имени записи.
 *
 * Отдельный файл в `shared/db`, а не в `modules/telegram`: и модуль уведомлений
 * (webhook, секрет), и интеграция (клиент Bot API, откуда брать токен) читают
 * системные секреты, а `modules/telegram` не должен становиться зависимостью
 * `integrations/telegram` — это перевернуло бы слои.
 */

export async function findSecretValue(name: string): Promise<string | null> {
  const row = await prisma.systemSecret.findUnique({ where: { name }, select: { value: true } })
  return row?.value ?? null
}

export async function saveSecretValue(name: string, value: string, rotatedById: string): Promise<Date> {
  const row = await prisma.systemSecret.upsert({
    where: { name },
    create: { name, value, rotatedById },
    update: { value, valueHash: null, rotatedById, rotatedAt: new Date() },
    select: { rotatedAt: true },
  })
  return row.rotatedAt
}

/** true — запись была и удалена. */
export async function deleteSecret(name: string): Promise<boolean> {
  const { count } = await prisma.systemSecret.deleteMany({ where: { name } })
  return count > 0
}
