import { assertCan } from '@/shared/auth/permissions'
import type { CurrentUser } from '@/shared/auth/current-user'
import { TELEGRAM_DIGEST } from '@/shared/config/telegram.config'
import type { PulseDto } from '@/shared/contracts/stage-analytics'
import * as recommendationsService from '@/modules/recommendations/recommendations.service'
import * as telegramRepo from '@/modules/telegram/telegram.repo'
import { loadPulseExtras } from './pulse.extras'
import { buildPulse, toPulseDto, type DigestRecommendationSource, type DigestSources } from './pulse.rules'

/**
 * Пульс пользователя (решение 120): страница «Пульс» (`GET /api/me/pulse`) и сводка
 * в Telegram (`telegram.service.digestFor`) собираются здесь из одних источников.
 * Право — как у сводки и рекомендаций (аналитика): представителю вуза пульса нет.
 */

function relatedStageNumber(relatedData: Record<string, unknown> | null): number | null {
  const value = relatedData?.stageNumber
  return typeof value === 'number' ? value : null
}

/** Источники пульса: этапы и рекомендации связок пользователя плюс расширения. */
export async function pulseSourcesFor(user: CurrentUser, now: Date = new Date()): Promise<DigestSources> {
  assertCan(user, 'ANALYTICS')
  const [stages, recommendationRows, extras] = await Promise.all([
    telegramRepo.findDigestStages(user.id, now, TELEGRAM_DIGEST.stagesFetch),
    telegramRepo.findOpenRecommendationsOf(user.id, TELEGRAM_DIGEST.recommendationsFetch),
    loadPulseExtras(user, now),
  ])
  const recommendations = (await recommendationsService.toRecommendationDtos(recommendationRows)).map(
    (item): DigestRecommendationSource => ({
      id: item.id,
      ruleKey: item.ruleKey,
      stageNumber: relatedStageNumber(item.relatedData),
      title: item.title,
      label: item.target.label,
      priority: item.priority,
      cooperationId: item.cooperationId,
      status: item.status,
      createdAt: new Date(item.createdAt),
    }),
  )
  return { stages, recommendations, extras }
}

export async function pulseFor(user: CurrentUser, now: Date = new Date()): Promise<PulseDto> {
  return toPulseDto(buildPulse(await pulseSourcesFor(user, now), now))
}
