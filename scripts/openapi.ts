/**
 * Сборка docs/openapi.json из реестра эндпоинтов.
 * Запуск: npm run openapi
 */
import { writeFile } from 'node:fs/promises'
import { buildOpenApiDocument } from '../src/shared/openapi/build'
import { ENDPOINTS } from '../src/shared/openapi/registry'

const target = 'docs/openapi.json'

async function main(): Promise<void> {
  const document = buildOpenApiDocument(process.env.APP_BASE_URL ?? 'http://localhost:3000')
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  const paths = Object.keys((document.paths as Record<string, unknown>) ?? {})
  console.log(`Спецификация записана: ${target}`)
  console.log(`  путей: ${paths.length}`)
  console.log(`  операций: ${ENDPOINTS.length}`)
}

main().catch((error) => {
  console.error('Не удалось собрать спецификацию:', error)
  process.exitCode = 1
})
