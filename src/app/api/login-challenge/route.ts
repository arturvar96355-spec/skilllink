import { resolveSecret } from '@/shared/auth/auth'
import { createChallenge } from '@/shared/auth/captcha'
import { handle, ok } from '@/shared/http'

/**
 * Задача для проверки «не робот» на входе (captcha.ts, решение 100).
 *
 * Без входа: её просит экран входа, когда сервер ответил `captcha_required`.
 * Ничего не хранит и ничего не раскрывает — каждый запрос получает новую
 * задачу, а решить её за другого нельзя: решение действует один раз.
 */
export const dynamic = 'force-dynamic'

export const GET = handle(async () => ok(createChallenge(resolveSecret())))
