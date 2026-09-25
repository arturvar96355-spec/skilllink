import { z } from '@/shared/zod'
import { ERROR_STATUS, type ErrorCode } from '@/shared/http/errors'
import { ENDPOINTS, type EndpointSpec } from './registry'

/**
 * Сборка спецификации OpenAPI 3.1 из реестра эндпоинтов.
 *
 * Схемы параметров и тел запросов берутся прямо из Zod-схем модулей, поэтому
 * спецификация не расходится с кодом (концепция: «интеграционные интерфейсы описаны
 * по спецификации OpenAPI»).
 *
 * Схемы ответов описаны обобщённо: DTO задаются типами TypeScript в `shared/contracts`,
 * а не схемами времени выполнения, и выводить из них JSON Schema было бы отдельной
 * подсистемой. Точные поля ответов описаны в docs/API_CONTRACT.md.
 */

type JsonSchema = Record<string, unknown>

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  // unrepresentable: 'any' нужен из-за `.transform()` в фильтрах списков:
  // преобразование «одно значение или массив» в JSON Schema не выражается.
  const result = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema
  delete result.$schema
  return result
}

/** Параметры пути: берутся из самого пути, отдельного описания не требуют. */
function pathParameters(path: string): JsonSchema[] {
  return [...path.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'Идентификатор (cuid)',
  }))
}

/** Query-параметры разворачиваются из объектной схемы по одному. */
function queryParameters(schema: z.ZodType): JsonSchema[] {
  const json = toJsonSchema(schema, 'input')
  const properties = (json.properties as Record<string, JsonSchema> | undefined) ?? {}
  const required = (json.required as string[] | undefined) ?? []

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema: property,
  }))
}

const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', enum: Object.keys(ERROR_STATUS) },
        message: { type: 'string', description: 'Текст на русском языке' },
        details: {
          description: 'Для ошибок валидации — массив { field, message }',
        },
      },
    },
  },
}

function successSchema(spec: EndpointSpec): JsonSchema {
  if (!spec.list) {
    return {
      type: 'object',
      required: ['data'],
      properties: { data: { description: 'Полезная нагрузка. Поля — в docs/API_CONTRACT.md' } },
    }
  }

  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: {} },
      meta: {
        type: 'object',
        required: ['page', 'pageSize', 'total'],
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
        },
        description: 'Отдельные списки добавляют сюда свои поля',
      },
    },
  }
}

function errorResponses(errors: readonly ErrorCode[]): Record<string, JsonSchema> {
  const byStatus = new Map<number, Set<ErrorCode>>()
  for (const code of errors) {
    const status = ERROR_STATUS[code]
    const bucket = byStatus.get(status) ?? new Set<ErrorCode>()
    bucket.add(code)
    byStatus.set(status, bucket)
  }

  const responses: Record<string, JsonSchema> = {}
  for (const [status, codes] of byStatus) {
    responses[String(status)] = {
      description: [...codes].join(' / '),
      content: { 'application/json': { schema: ERROR_SCHEMA } },
    }
  }
  return responses
}

const PERMISSION_NOTES: Record<string, string> = {
  ANY: 'Доступно любому определённому пользователю',
  READ: 'Роли: ADMIN, MANAGER, ANALYST, VIEWER, UNIVERSITY_REP',
  WRITE: 'Роли: ADMIN, MANAGER',
  ANALYTICS: 'Роли: ADMIN, MANAGER, ANALYST, VIEWER',
  ANALYTICS_WORK: 'Роли: ADMIN, MANAGER, ANALYST',
  ADMIN: 'Роль: ADMIN',
  UNIVERSITY_PORTAL: 'Роли: ADMIN, MANAGER, UNIVERSITY_REP',
  UNIVERSITY_PORTAL_WRITE: 'Роль: UNIVERSITY_REP. Сотрудник ИТ-Школы в кабинете вуза только просматривает',
  CONTACT_DETAILS: 'Роли: ADMIN, MANAGER; UNIVERSITY_REP — контакты своего вуза',
}

function buildOperation(spec: EndpointSpec): JsonSchema {
  const parameters = [...pathParameters(spec.path)]
  if (spec.query) parameters.push(...queryParameters(spec.query))

  const description = [spec.description, `Право доступа: ${PERMISSION_NOTES[spec.permission]}.`]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n')

  const operation: JsonSchema = {
    tags: [spec.tag],
    summary: spec.summary,
    description,
    operationId: `${spec.method}${spec.path.replace(/[/{}]/g, '_')}`,
    ...(parameters.length > 0 ? { parameters } : {}),
    responses: {
      [spec.method === 'post' &&
      spec.returnsOk !== true &&
      !spec.path.includes('release') &&
      !spec.path.includes('generate')
        ? '201'
        : '200']: {
        description: 'Успех',
        content: { 'application/json': { schema: successSchema(spec) } },
      },
      ...errorResponses(spec.errors),
    },
  }

  if (spec.body) {
    operation.requestBody = {
      required: spec.bodyOptional !== true,
      content: { 'application/json': { schema: toJsonSchema(spec.body, 'input') } },
    }
  }

  return operation
}

export function buildOpenApiDocument(baseUrl = 'http://localhost:3000'): JsonSchema {
  const paths: Record<string, JsonSchema> = {}

  for (const spec of ENDPOINTS) {
    const existing = (paths[spec.path] as Record<string, unknown> | undefined) ?? {}
    existing[spec.method] = buildOperation(spec)
    paths[spec.path] = existing as JsonSchema
  }

  const tags = [...new Set(ENDPOINTS.map((spec) => spec.tag))].map((name) => ({ name }))

  return {
    openapi: '3.1.0',
    info: {
      title: 'SkillLink API',
      version: '1.0.0',
      description: [
        'Система контроля взаимодействия с учебными заведениями (IT Школа РТК).',
        '',
        'Спецификация собирается из тех же Zod-схем, которыми API проверяет входные данные,',
        'поэтому параметры и тела запросов не расходятся с кодом.',
        'Поля ответов подробно описаны в docs/API_CONTRACT.md.',
        '',
        'Аутентификация: NextAuth.js, вход по паролю через /api/auth/callback/credentials.',
        'Маршруты /api/auth/* обслуживает NextAuth и в этой спецификации не описаны.',
      ].join('\n'),
    },
    servers: [{ url: baseUrl }],
    tags,
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authjs.session-token',
          description: 'Cookie сессии, выданная NextAuth после входа по паролю',
        },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    security: [{ sessionCookie: [] }],
  }
}
