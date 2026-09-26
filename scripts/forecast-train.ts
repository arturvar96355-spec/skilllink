/**
 * Переобучение модели прогноза «дойдёт ли связка до вехи» (решение 135).
 *
 *   npm run forecast:train
 *
 * То же самое, что `POST /api/analytics/forecast/train` от администратора, но без
 * входа: удобно вызывать по расписанию (cron владельца сервера через сервис migrate,
 * как `db:retention`, — пока не включено, см. docs/DEPLOY.md). Факт обучения и коротко
 * что вышло — записываются в журнал действий (`forecast.model.train`, `userId: null`).
 *
 * Код выхода 1 — только при сбое (нет соединения с базой и т.п.), а не когда модель
 * честно не прошла ворота публикации: `insufficient_data` на маленькой демонстрационной
 * выборке — ожидаемый, а не аварийный исход.
 */

import 'dotenv/config'
import { prisma } from '@/shared/db/prisma'
import { runTraining } from '@/modules/analytics/forecast.service'

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error('Не задана переменная окружения DATABASE_URL')
    return 1
  }

  const result = await runTraining(null)
  for (const model of result.models) {
    const auc = model.metrics?.auc !== null && model.metrics?.auc !== undefined ? model.metrics.auc.toFixed(3) : '—'
    console.log(
      `Веха «${model.milestone.stageTitle}» (этап ${model.milestone.stageNumber}): ` +
        `статус ${model.status}, версия ${model.version ?? '—'}, AUC ${auc}`,
    )
  }
  return 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    console.error('Обучение модели прогноза не выполнено:', error instanceof Error ? error.message : String(error))
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  })
