/**
 * Сборка docs/openapi.json из реестра эндпоинтов.
 * Запуск: npm run openapi
 */
import { writeFile } from 'node:fs/promises'
import { buildOpenApiDocument } from '../src/shared/openapi/build'
import { ENDPOINTS } from '../src/shared/openapi/registry'

const target = 'docs/openapi.json'

async function main(): Promise<void> {
  // Сервер по умолчанию — относительный «/» (решение 212): файл из репозитория
  // работает с любого адреса, а не только с localhost:3000. APP_BASE_URL не читаем:
  // в CI он задан, и файл расходился бы с собранным локально.
  const document = buildOpenApiDocument('/')
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
