'use client'

import 'swagger-ui-dist/swagger-ui.css'
import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, SkeletonLines } from '@/ui'
import styles from './api-docs.module.css'

/**
 * Настоящий Swagger UI по спецификации OpenAPI (решение 212) вместо своей
 * страницы из решения 146: эксперт видит привычный инструмент, а не самоделку.
 *
 * - Спецификация — та же `/api/openapi.json` (buildOpenApiDocument): расходиться
 *   с кодом не с чего.
 * - «Try it out» ходит на этот же адрес (servers подменяются на origin страницы —
 *   APP_BASE_URL стенда мог бы увести запрос на другой хост) и несёт cookie
 *   текущей сессии: запрос выполняется с правами того, кто вошёл, — не больше,
 *   чем даёт обычный интерфейс.
 * - Проверка на validator.swagger.io выключена: наружу страница не ходит.
 * - Пакет (~1,4 МБ) грузится только здесь, отдельным куском сборки.
 */
type LoadState = 'loading' | 'ready' | 'error'

export function SwaggerView({ specUrl }: { specUrl: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    async function mount() {
      const [bundle, response] = await Promise.all([
        import('swagger-ui-dist/swagger-ui-bundle.js'),
        fetch(specUrl, { credentials: 'same-origin', cache: 'no-store' }),
      ])
      if (!response.ok) throw new Error(`Спецификация не получена: ${response.status}`)
      const spec = (await response.json()) as Record<string, unknown>
      if (cancelled || !hostRef.current) return
      spec.servers = [{ url: window.location.origin, description: 'Этот сервер — запросы под вашей сессией' }]

      const SwaggerUIBundle = bundle.default
      hostRef.current.replaceChildren()
      SwaggerUIBundle({
        domNode: hostRef.current,
        spec,
        // Ссылки на операции в адресе выключены: operationId вида get_api_me Swagger
        // принимает за «пробел через _» и пишет ошибку в консоль на каждый щелчок.
        deepLinking: false,
        docExpansion: 'none',
        defaultModelsExpandDepth: -1,
        defaultModelExpandDepth: 2,
        displayRequestDuration: true,
        filter: true,
        persistAuthorization: false,
        validatorUrl: null,
        syntaxHighlight: { activated: true, theme: 'agate' },
        requestInterceptor: (request) => {
          // Cookie сессии — только на свой адрес; чужим хостам её не отдаём.
          request.credentials = 'same-origin'
          return request
        },
        onComplete: () => {
          if (!cancelled) setState('ready')
        },
      })
    }

    mount().catch(() => {
      if (!cancelled) setState('error')
    })
    return () => {
      cancelled = true
    }
  }, [specUrl, attempt])

  return (
    <div className={styles.frame} aria-busy={state === 'loading'}>
      {state === 'loading' && (
        <div className={styles.placeholder}>
          <SkeletonLines count={8} />
        </div>
      )}
      {state === 'error' && (
        <EmptyState
          icon="alert"
          title="Swagger UI не загрузился"
          description="Спецификация по-прежнему доступна файлом — откройте openapi.json или повторите загрузку."
          action={
            <Button variant="secondary" icon="refresh" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </Button>
          }
        />
      )}
      <div ref={hostRef} className={styles.swagger} hidden={state === 'error'} />
    </div>
  )
}
