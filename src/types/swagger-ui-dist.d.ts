/**
 * Swagger UI из `swagger-ui-dist` (решение 212): собранный UMD-файл без своих
 * типов. Описано только то, чем пользуется страница `/api-docs`.
 */
declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
  interface SwaggerRequest {
    url: string
    method?: string
    headers: Record<string, string>
    credentials?: RequestCredentials
    [key: string]: unknown
  }

  interface SwaggerUIOptions {
    domNode: HTMLElement
    spec?: Record<string, unknown>
    url?: string
    deepLinking?: boolean
    docExpansion?: 'list' | 'full' | 'none'
    defaultModelsExpandDepth?: number
    defaultModelExpandDepth?: number
    displayRequestDuration?: boolean
    filter?: boolean | string
    tryItOutEnabled?: boolean
    persistAuthorization?: boolean
    validatorUrl?: string | null
    syntaxHighlight?: false | { activated?: boolean; theme?: string }
    requestInterceptor?: (request: SwaggerRequest) => SwaggerRequest
    onComplete?: () => void
  }

  interface SwaggerUIInstance {
    getSystem?: () => unknown
  }

  const SwaggerUIBundle: (options: SwaggerUIOptions) => SwaggerUIInstance
  export default SwaggerUIBundle
}

declare module 'swagger-ui-dist/swagger-ui.css'
