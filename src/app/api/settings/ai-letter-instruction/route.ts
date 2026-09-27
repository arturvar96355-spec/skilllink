import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import * as service from '@/modules/ai-assist/ai-assist.letter-instruction'
import { letterInstructionSchema } from '@/modules/ai-assist/ai-assist.schema'

/**
 * Инструкция для писем ИИ (решение 213): тон, подпись, что упоминать, чего избегать.
 * Подставляется в промпт писем поверх базовых правил. Только ADMIN; изменение — в журнал.
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.getLetterInstruction(user))
})

export const PUT = handle(async (request) => {
  const user = await getCurrentUser()
  const input = await parseBody(request, letterInstructionSchema)
  return ok(await service.updateLetterInstruction(user, input))
})

/** «Вернуть по умолчанию»: письма снова пишутся только по базовым правилам. */
export const DELETE = handle(async () => {
  const user = await getCurrentUser()
  return ok(await service.resetLetterInstruction(user))
})
