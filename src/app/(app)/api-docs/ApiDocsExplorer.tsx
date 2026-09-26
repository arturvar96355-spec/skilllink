'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, Icon, Input, Textarea, type BadgeTone } from '@/ui'
import styles from './api-docs.module.css'

export interface ApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  description: string
}

export interface ApiOperation {
  id: string
  method: string
  path: string
  tag: string
  summary: string
  description: string
  parameters: ApiParameter[]
  bodyRequired: boolean
  bodyExample: unknown
  isPublic: boolean
}

const METHOD_TONE: Record<string, BadgeTone> = {
  GET: 'info',
  POST: 'success',
  PATCH: 'warning',
  PUT: 'warning',
  DELETE: 'danger',
}

interface ExecResult {
  status: number
  ok: boolean
  durationMs: number
  body: string
}

/** Подставляет значения path-параметров в путь: `/api/universities/{id}` → `/api/universities/uni-1`. */
function buildUrl(operation: ApiOperation, values: Record<string, string>): { url: string; missing: string[] } {
  const missing: string[] = []
  let path = operation.path
  for (const param of operation.parameters.filter((p) => p.in === 'path')) {
    const value = values[param.name]?.trim()
    if (!value) missing.push(param.name)
    path = path.replace(`{${param.name}}`, encodeURIComponent(value ?? ''))
  }

  const query = new URLSearchParams()
  for (const param of operation.parameters.filter((p) => p.in === 'query')) {
    const value = values[param.name]?.trim()
    if (!value) {
      if (param.required) missing.push(param.name)
      continue
    }
    query.set(param.name, value)
  }
  const queryString = query.toString()
  return { url: queryString ? `${path}?${queryString}` : path, missing }
}

function OperationPanel({ operation }: { operation: ApiOperation }) {
  const [open, setOpen] = useState(false)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [bodyText, setBodyText] = useState(
    operation.bodyExample !== null && operation.bodyExample !== undefined
      ? JSON.stringify(operation.bodyExample, null, 2)
      : '',
  )
  const [bearer, setBearer] = useState('')
  const [result, setResult] = useState<ExecResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const hasBody = ['POST', 'PATCH', 'PUT'].includes(operation.method)

  const run = async () => {
    setError(null)
    setResult(null)

    const { url, missing } = buildUrl(operation, paramValues)
    if (missing.length > 0) {
      setError(`Заполните обязательные параметры: ${missing.join(', ')}`)
      return
    }

    let body: string | undefined
    if (hasBody && bodyText.trim() !== '') {
      try {
        JSON.parse(bodyText)
        body = bodyText
      } catch {
        setError('Тело запроса — не корректный JSON')
        return
      }
    } else if (hasBody && operation.bodyRequired) {
      setError('Тело запроса обязательно для этой операции')
      return
    }

    setIsRunning(true)
    const startedAt = performance.now()
    try {
      const response = await fetch(url, {
        method: operation.method,
        // Запрос идёт под текущей сессией (cookie отправляется сама, same-origin) —
        // «Выполнить» не даёт прав больше, чем у вошедшего есть в обычном интерфейсе.
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(bearer.trim() !== '' ? { authorization: `Bearer ${bearer.trim()}` } : {}),
        },
        body,
      })
      const text = await response.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // Не JSON (например, файл или пустой ответ) — показываем как есть.
      }
      setResult({ status: response.status, ok: response.ok, durationMs: performance.now() - startedAt, body: pretty })
    } catch {
      setError('Запрос не выполнен: сеть или CORS. Смотрите консоль браузера.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className={styles.operation}>
      <button type="button" className={styles.operationHead} onClick={() => setOpen((value) => !value)}>
        <Badge tone={METHOD_TONE[operation.method] ?? 'neutral'}>{operation.method}</Badge>
        <span className={styles.operationPath}>{operation.path}</span>
        <span className={styles.operationSummary}>{operation.summary}</span>
        {operation.isPublic && <Badge tone="neutral">без входа</Badge>}
        <Icon name="chevronDown" size={16} className={open ? styles.chevronOpen : undefined} />
      </button>

      {open && (
        <div className={styles.operationBody}>
          {operation.description && <p className={styles.description}>{operation.description}</p>}

          {operation.parameters.length > 0 && (
            <div className={styles.params}>
              {operation.parameters.map((param) => (
                <Input
                  key={`${param.in}:${param.name}`}
                  label={`${param.name} (${param.in === 'path' ? 'путь' : 'query'})${param.required ? ' *' : ''}`}
                  hint={param.description || undefined}
                  value={paramValues[param.name] ?? ''}
                  onChange={(event) =>
                    setParamValues((prev) => ({ ...prev, [param.name]: event.target.value }))
                  }
                />
              ))}
            </div>
          )}

          {hasBody && (
            <Textarea
              label={`Тело запроса (JSON)${operation.bodyRequired ? ' *' : ''}`}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              rows={Math.min(16, Math.max(4, bodyText.split('\n').length))}
              className={styles.jsonArea}
            />
          )}

          <Input
            label="Bearer-токен (необязательно)"
            hint="Заготовка для будущих интеграций (см. docs/ARCHITECTURE.md, «Авторизация и Keycloak») — сейчас API проверяет только вход по cookie, значение уйдёт в заголовок, но не заменит сессию"
            value={bearer}
            onChange={(event) => setBearer(event.target.value)}
            placeholder="без токена — запрос идёт под вашей сессией"
          />

          <div className={styles.actions}>
            <Button variant="primary" onClick={run} isLoading={isRunning}>
              Выполнить
            </Button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          {result && (
            <div className={styles.result}>
              <div className={styles.resultHead}>
                <Badge tone={result.ok ? 'success' : 'danger'}>{result.status}</Badge>
                <span className={styles.resultMeta}>{Math.round(result.durationMs)} мс</span>
              </div>
              <pre className={styles.resultBody}>{result.body || '(пустой ответ)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ApiDocsExplorer({ operations }: { operations: ApiOperation[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return operations
    return operations.filter(
      (operation) =>
        operation.path.toLowerCase().includes(needle) ||
        operation.summary.toLowerCase().includes(needle) ||
        operation.tag.toLowerCase().includes(needle),
    )
  }, [operations, query])

  const byTag = useMemo(() => {
    const map = new Map<string, ApiOperation[]>()
    for (const operation of filtered) {
      const list = map.get(operation.tag) ?? []
      list.push(operation)
      map.set(operation.tag, list)
    }
    return map
  }, [filtered])

  return (
    <div className={styles.wrap}>
      <Input
        label="Поиск по операциям"
        hideLabel
        icon="search"
        placeholder="Путь, раздел или название операции"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={styles.search}
      />
      <p className={styles.count}>
        {filtered.length} из {operations.length} операций
      </p>

      {[...byTag.entries()].map(([tag, tagOperations]) => (
        <section key={tag} className={styles.tagSection}>
          <h2 className={styles.tagTitle}>{tag}</h2>
          <div className={styles.list}>
            {tagOperations.map((operation) => (
              <OperationPanel key={operation.id} operation={operation} />
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && <p className={styles.empty}>Ничего не найдено по запросу «{query}»</p>}
    </div>
  )
}
