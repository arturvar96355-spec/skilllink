import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as aiService from '@/modules/ai-assist/ai-assist.service'
import * as lettersService from '@/modules/inbound-letters/inbound-letters.service'
import { aiRewriteSchema } from '@/modules/ai-assist/ai-assist.schema'

/**
 * Переделка черновика письма кнопками «Короче», «Мягче», «Настойчивее»… (решение 213).
 *
 * GET — можно ли сейчас переделывать: модель выключена или не настроена —
 * кнопки неактивны с пояснением. POST — переделать текст сотрудника (с его правками)
 * по заданию кнопки. Права и маскировка — у сервиса того письма, которое переделывается:
 * письмо вузу по рекомендации — WRITE, ответ на письмо вуза — INBOUND_REVIEW.
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(aiService.rewriteStatus(user))
})

export const POST = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, aiRewriteSchema)
  const body = { text: input.text, style: input.style }
  return ok(
    input.target.type === 'recommendation-letter'
      ? await aiService.rewriteRecommendationLetter(user, input.target.id, body)
      : await lettersService.rewriteReplyDraft(user, input.target.id, body),
  )
})
