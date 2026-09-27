import { Button, HelpHint, PageHeader } from '@/ui'
import { SwaggerView } from './SwaggerView'

/**
 * `/api-docs` — Swagger UI по спецификации OpenAPI (ТЗ, п. 6; решение 212).
 *
 * Решение 146 собрало здесь свою страницу: `swagger-ui-dist` тогда не было в
 * зависимостях. Эксперт принял её за самоделку — теперь это настоящий
 * Swagger UI на той же спецификации `/api/openapi.json`.
 *
 * Доступ — только вошедшим сотрудникам: страница внутри `(app)`, как и весь
 * кабинет. «Try it out» шлёт запрос под сессией посетителя и её правами — не
 * больше, чем даёт обычный интерфейс (решение 146). Сама спецификация
 * открыта без входа: это описание интерфейса, а не данные.
 */
const SPEC_URL = '/api/openapi.json'

export default function ApiDocsPage() {
  return (
    <>
      <PageHeader
        title="Swagger: описание API"
        description="Описание всех методов API в формате OpenAPI 3; можно выполнить запрос прямо отсюда."
        meta={
          <HelpHint text="Раскройте метод, нажмите «Try it out», затем «Execute»: запрос уйдёт от вашего имени, с правами вашей роли. Изменяющие методы меняют данные по-настоящему." />
        }
        actions={
          <Button
            variant="secondary"
            icon="download"
            href={SPEC_URL}
            external
            newTab
            aria-label="Спецификация openapi.json — откроется в новой вкладке"
          >
            openapi.json
          </Button>
        }
      />
      <SwaggerView specUrl={SPEC_URL} />
    </>
  )
}
