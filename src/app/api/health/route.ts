import { prisma } from '@/shared/db/prisma'
import { handle, ok } from '@/shared/http'

/** Проверка живости приложения и подключения к базе. Используется smoke-сценарием. */
export const GET = handle(async () => {
  await prisma.$queryRaw`SELECT 1`
  return ok({
    status: 'ok',
    database: 'connected',
    time: new Date().toISOString(),
  })
})
