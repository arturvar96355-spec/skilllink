import { integrationError } from '@/shared/http/errors'
import { requestJson } from '../http-client'
import { getIntegrationsConfig, type IntegrationCommonConfig } from '../config'

/**
 * Интеграция с LMS (раздел 14 ТЗ).
 *
 * По умолчанию выключена. Когда выключена, вызов возвращает понятный отказ,
 * а не падает: сбой интеграции не ломает основную систему (решение 13).
 */

export interface LmsCourseProgress {
  externalCourseId: string
  courseName: string
  /** Сколько преподавателей завершили обучение. */
  completedCount: number
  totalCount: number
  updatedAt: string
}

export interface IntegrationStatus {
  name: string
  enabled: boolean
  configured: boolean
  reason: string | null
}

export interface LmsClient {
  status(): IntegrationStatus
  fetchCourseProgress(externalCourseId: string): Promise<LmsCourseProgress>
}

/** Заглушка на время, пока доступа к LMS нет. Данные помечены как демонстрационные. */
export class MockLmsClient implements LmsClient {
  status(): IntegrationStatus {
    return {
      name: 'LMS (демонстрационный режим)',
      enabled: false,
      configured: false,
      reason: 'Интеграция выключена: LMS_ENABLED=false',
    }
  }

  async fetchCourseProgress(externalCourseId: string): Promise<LmsCourseProgress> {
    throw integrationError(
      'Интеграция с LMS выключена. Включите LMS_ENABLED и задайте LMS_API_URL. ' +
        `Запрошенный курс: ${externalCourseId}`,
    )
  }
}

export class HttpLmsClient implements LmsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly common: IntegrationCommonConfig,
  ) {}

  status(): IntegrationStatus {
    return { name: 'LMS', enabled: true, configured: true, reason: null }
  }

  async fetchCourseProgress(externalCourseId: string): Promise<LmsCourseProgress> {
    const url = new URL(`courses/${encodeURIComponent(externalCourseId)}/progress`, this.baseUrl)

    const response = await requestJson<Partial<LmsCourseProgress>>({
      service: 'lms',
      url: url.toString(),
      token: this.token,
      config: this.common,
    })

    if (
      typeof response.completedCount !== 'number' ||
      typeof response.totalCount !== 'number'
    ) {
      throw integrationError('LMS вернула ответ неожиданного формата')
    }

    return {
      externalCourseId,
      courseName: response.courseName ?? externalCourseId,
      completedCount: response.completedCount,
      totalCount: response.totalCount,
      updatedAt: response.updatedAt ?? new Date().toISOString(),
    }
  }
}

export function getLmsClient(): LmsClient {
  const config = getIntegrationsConfig()
  if (!config.lms.enabled || !config.lms.baseUrl) return new MockLmsClient()
  return new HttpLmsClient(config.lms.baseUrl, config.lms.token, config.common)
}
