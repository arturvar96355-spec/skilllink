'use client'

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/ui/overlays/Toast'

/**
 * Обёртки, нужные клиентским компонентам.
 *
 * `SessionProvider` даёт хук `useSession()` во всём дереве: без него фронт
 * не сможет узнать текущего пользователя на клиенте. `ToastProvider` держит
 * очередь коротких сообщений о результате действий — он должен быть выше
 * всех страниц, иначе сообщение исчезнет вместе с тем экраном, где оно возникло.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  )
}
