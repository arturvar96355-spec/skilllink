import { prisma } from '@/shared/db/prisma'
import type { DocumentsSummary } from './ai-story.rules'

/**
 * Документы связки для «Истории сотрудничества» (решение 138): сколько подписано
 * из скольких. Архивные версии не считаются — как в сборке пакета документов
 * (`documents.repo.findPackageDocuments`): это черновики, которые заменила
 * действующая версия.
 */
export async function findDocumentsSummary(cooperationId: string): Promise<DocumentsSummary> {
  const [signed, total] = await Promise.all([
    prisma.document.count({ where: { cooperationId, status: 'SIGNED' } }),
    prisma.document.count({ where: { cooperationId, status: { not: 'ARCHIVED' } } }),
  ])
  return { signed, total }
}
