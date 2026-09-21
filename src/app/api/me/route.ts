import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok } from '@/shared/http'
import { describeCurrentUser } from '@/modules/auth/auth.service'

/**
 * Текущий пользователь и его права.
 * P0: пользователь выбирается cookie `skilllink_user`. P1: NextAuth.js, контракт не меняется.
 */
export const GET = handle(async () => {
  const user = await getCurrentUser()
  return ok(describeCurrentUser(user))
})
