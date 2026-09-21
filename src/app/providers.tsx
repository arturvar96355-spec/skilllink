'use client'

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'

/**
 * Обёртки, нужные клиентским компонентам.
 *
 * `SessionProvider` даёт хук `useSession()` во всём дереве: без него фронт не сможет
 * узнать текущего пользователя на клиенте. Это инфраструктура аутентификации,
 * а не оформление — дизайн и вёрстка делаются отдельно.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
