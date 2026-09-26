/**
 * Пример тела запроса по JSON Schema операции — только для прогрева формы
 * «Выполнить» на `/api-docs` (ТЗ, п. 6 — интерактивная страница Swagger;
 * решение 146). Не валидирует и не претендует на полноту: цель — дать
 * заполненный черновик, который проще поправить, чем набирать с нуля.
 *
 * Заполняются только обязательные поля (`required`) — необязательные в примере
 * не нужны, а их отсутствие само по себе подсказывает, что поле необязательное.
 */
type JsonSchema = Record<string, unknown>

function firstNonNullVariant(variants: JsonSchema[]): JsonSchema | undefined {
  return variants.find((variant) => variant.type !== 'null') ?? variants[0]
}

export function exampleFromSchema(schema: JsonSchema | null | undefined, depth = 0): unknown {
  if (!schema || depth > 6) return undefined

  if ('default' in schema) return schema.default
  const examples = schema.examples
  if (Array.isArray(examples) && examples.length > 0) return examples[0]
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0]

  const variants = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined
  if (Array.isArray(variants) && variants.length > 0) {
    return exampleFromSchema(firstNonNullVariant(variants), depth + 1)
  }

  const type = schema.type
  if (type === 'object' || schema.properties) {
    const properties = (schema.properties as Record<string, JsonSchema>) ?? {}
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      if (!required.has(key)) continue
      result[key] = exampleFromSchema(value, depth + 1)
    }
    return result
  }
  if (type === 'array') return []
  if (type === 'string') {
    if (schema.format === 'date-time') return new Date().toISOString()
    if (schema.format === 'date') return new Date().toISOString().slice(0, 10)
    return ''
  }
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  return null
}
