import type { ReactNode } from 'react'
import { AppShell } from '@/ui'

/**
 * Каркас внутренних страниц.
 *
 * Всё, что лежит в этой группе маршрутов, получает боковое меню, шапку,
 * подвал и глобальный поиск. Страница отвечает только за своё содержимое —
 * собирать каркас заново она не должна (раздел 34 шаблона страниц).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
