import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseOptionalBody } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-story.service'
import { createProposalSchema } from '@/modules/ai-assist/ai-story.schema'

type Context = { params: Promise<{ id: string }> }

/**
 * «Предложить план» (решение 138): проект встречи или новой даты этапа —
 * по препятствиям связки. Ничего не сохраняет: проект живёт час, применяет его
 * человек отдельным запросом (`POST .../proposals/{proposalId}/apply`).
 * Тело необязательно: без него сервис сам выбирает вид проекта по препятствиям.
 */
export const POST = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { id } = await context.params
  const input = await parseOptionalBody(request, createProposalSchema)
  return ok(await service.createProposal(user, id, input))
})
