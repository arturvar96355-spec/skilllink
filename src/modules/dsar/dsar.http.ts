import type { DsarExportDto } from '@/shared/contracts/dsar'

/**
 * Ответ-файл выгрузки «всё о субъекте»: JSON вложением, без кэша ни в браузере,
 * ни в промежуточных узлах — в нём все ПД человека.
 */
export function dsarFileResponse(result: DsarExportDto): Response {
  const date = result.generatedAt.slice(0, 10)
  const kind = result.subject.type === 'USER' ? 'user' : 'contact'
  const fileName = `skilllink-dsar-${kind}-${result.subject.id}-${date}.json`
  return new Response(JSON.stringify({ data: result }, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
