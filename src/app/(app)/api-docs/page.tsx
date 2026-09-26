import { buildOpenApiDocument } from '@/shared/openapi/build'
import { exampleFromSchema } from '@/shared/openapi/example'
import { PageHeader } from '@/ui'
import { ApiDocsExplorer, type ApiOperation, type ApiParameter } from './ApiDocsExplorer'

/**
 * `/api-docs` — интерактивная страница Swagger (ТЗ, п. 6; решение 146).
 *
 * В node_modules нет ни swagger-ui-dist, ни redoc, ни scalar (проверено —
 * ставить новый пакет нельзя, node_modules общий), поэтому это своя лёгкая
 * страница: серверный компонент собирает список операций прямо из
 * `buildOpenApiDocument()` (та же функция, что отдаёт `/api/openapi.json` —
 * список не может разойтись со спецификацией), клиентский — раскрывает
 * операцию и выполняет запрос.
 *
 * Доступ: только вошедшим сотрудникам — страница внутри `(app)`, как и весь
 * остальной кабинет (решение 146: обоснование — «Выполнить» шлёт запрос под
 * настоящей сессией посетителя и её правами, то есть не даёт прав больше, чем
 * у него уже есть через обычный интерфейс или прямой вызов API; открывать
 * список операций анонимно незачем, раз `/api/openapi.json` для этого и так
 * не требует входа).
 */
export const dynamic = 'force-dynamic'

type RawOperation = {
  operationId?: string
  tags?: string[]
  summary?: string
  description?: string
  parameters?: Array<{ name: string; in: string; required?: boolean; description?: string }>
  requestBody?: { required?: boolean; content?: { 'application/json'?: { schema?: Record<string, unknown> } } }
  security?: unknown[]
}

function collectOperations(): ApiOperation[] {
  const spec = buildOpenApiDocument(process.env.APP_BASE_URL ?? 'http://localhost:3000') as {
    paths: Record<string, Record<string, RawOperation>>
  }
  const methods = ['get', 'post', 'patch', 'put', 'delete']
  const operations: ApiOperation[] = []

  for (const [path, byMethod] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(byMethod)) {
      if (!methods.includes(method)) continue
      const bodySchema = operation.requestBody?.content?.['application/json']?.schema ?? null
      const parameters: ApiParameter[] = (operation.parameters ?? []).map((param) => ({
        name: param.name,
        in: param.in as ApiParameter['in'],
        required: param.required === true,
        description: param.description ?? '',
      }))
      operations.push({
        id: operation.operationId ?? `${method}_${path}`,
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? 'Другое',
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        parameters,
        bodyRequired: operation.requestBody?.required === true,
        bodyExample: bodySchema ? exampleFromSchema(bodySchema) : null,
        // security: [] — операция помечена публичной (build.ts); иначе действует
        // общая схема (cookie сессии), в списке операций это не показывается отдельно.
        isPublic: Array.isArray(operation.security) && operation.security.length === 0,
      })
    }
  }

  return operations.sort((a, b) => a.tag.localeCompare(b.tag, 'ru') || a.path.localeCompare(b.path))
}

export default function ApiDocsPage() {
  const operations = collectOperations()
  return (
    <>
      <PageHeader
        title="Контракт API — Swagger"
        description={
          'Операции из спецификации OpenAPI (та же, что отдаёт /api/openapi.json), сгруппированные по разделам. ' +
          'У каждой — описание, параметры, схема тела и форма «Выполнить»: запрос уходит под вашей текущей ' +
          'сессией и её правами — «Выполнить» не даёт больше, чем обычный интерфейс. Поле Bearer-токена — ' +
          'заготовка для интеграций: сейчас API проверяет только cookie сессии, заголовок уходит в запрос, ' +
          'но пока ничем не заменяет вход.'
        }
      />
      <ApiDocsExplorer operations={operations} />
    </>
  )
}
