import { integrationError } from '@/shared/http/errors'
import { requestJson } from '../http-client'
import { getIntegrationsConfig, type IntegrationCommonConfig } from '../config'
import type { IntegrationStatus } from '../lms/lms.client'

/**
 * Интеграция с сайтом: заявки на обучение приходят оттуда (концепция).
 * По умолчанию выключена; пока выключена, заявки вносятся вручную через кабинет вуза.
 */
export interface SiteApplication {
  externalRef: string
  programExternalId: string
  quantity: number
  submittedAt: string
}

export interface SiteClient {
  status(): IntegrationStatus
  fetchApplications(since?: string): Promise<SiteApplication[]>
}

export class MockSiteClient implements SiteClient {
  status(): IntegrationStatus {
    return {
      name: 'Сайт (демонстрационный режим)',
      enabled: false,
      configured: false,
      reason: 'Интеграция выключена: SITE_ENABLED=false',
    }
  }

  async fetchApplications(): Promise<SiteApplication[]> {
    throw integrationError(
      'Интеграция с сайтом выключена. Включите SITE_ENABLED и задайте SITE_API_URL. ' +
        'Пока заявки вносятся вручную через кабинет вуза.',
    )
  }
}

export class HttpSiteClient implements SiteClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly common: IntegrationCommonConfig,
  ) {}

  status(): IntegrationStatus {
    return { name: 'Сайт', enabled: true, configured: true, reason: null }
  }

  async fetchApplications(since?: string): Promise<SiteApplication[]> {
    const url = new URL('applications', this.baseUrl)
    if (since) url.searchParams.set('since', since)

    const response = await requestJson<{ items?: unknown }>({
      service: 'site',
      url: url.toString(),
      token: this.token,
      config: this.common,
    })

    if (!Array.isArray(response.items)) {
      throw integrationError('Сайт вернул ответ неожиданного формата')
    }

    return response.items.filter((item): item is SiteApplication => {
      if (typeof item !== 'object' || item === null) return false
      const candidate = item as Record<string, unknown>
      return (
        typeof candidate.externalRef === 'string' &&
        typeof candidate.programExternalId === 'string' &&
        typeof candidate.quantity === 'number'
      )
    })
  }
}

export function getSiteClient(): SiteClient {
  const config = getIntegrationsConfig()
  if (!config.site.enabled || !config.site.baseUrl) return new MockSiteClient()
  return new HttpSiteClient(config.site.baseUrl, config.site.token, config.common)
}
