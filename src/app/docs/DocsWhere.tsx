'use client'

import Link from 'next/link'
import { Icon } from '@/ui/primitives/Icon'
import { useOptionalCurrentUser } from '@/ui/layout/CurrentUser'
import { isSectionAllowed } from '@/ui/layout/navigation'
import styles from './docs.module.css'

/**
 * «Где найти» — ссылка на экран системы (решение 214).
 *
 * На `/docs` без входа ссылка ведёт как есть: без сессии система сначала
 * попросит войти и вернёт на этот экран. Внутри системы (`/help`) ссылка на
 * раздел, закрытый роли, не показывается — вместо неё пояснение, как в меню.
 */
export function DocsWhere({ href, label }: { href: string; label: string }) {
  const user = useOptionalCurrentUser()
  const path = href.replace(/[?#].*$/, '')
  if (user && !isSectionAllowed(user, path)) {
    return <span className={styles.whereClosed}>{label.replace(/^Открыть\s*/, '')} — раздел закрыт для вашей роли</span>
  }
  return (
    <Link href={href} className={styles.where}>
      {label}
      <Icon name="arrowRight" size={16} />
    </Link>
  )
}
