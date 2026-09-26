'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { REAUTH_PARAM } from '@/shared/auth/reauth'
import type { CurrentUserDto } from '@/shared/contracts'
import { Button } from '../primitives/Button'
import { Skeleton } from '../primitives/Skeleton'
import { ErrorState, SectionUnavailable } from '../data/States'
import { GlobalSearch } from '../search/GlobalSearch'
import { useResource } from '../hooks/useResource'
import { CurrentUserProvider } from './CurrentUser'
import { Footer } from './Footer'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { isSectionAllowed, navigationFor, serviceLinksFor } from './navigation'
import { takeArrival } from './arrival'
import { useNavigationMotion } from './navigation-motion'
import { LiveBackground } from './LiveBackground'
import { MobileTabBar } from './MobileTabBar'
import { useMagneticButtons } from './magnetic'
import styles from './Shell.module.css'

/**
 * Каркас приложения.
 *
 * Текущий пользователь запрашивается здесь один раз: от его роли зависит состав
 * бокового меню, поэтому до ответа рисовать меню нельзя — иначе представитель
 * вуза на мгновение увидит разделы, которые ему закрыты.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  // Первое открытие после входа: меню и шапка дописывают сцену входа (07, раздел 18).
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    if (!takeArrival()) return
    setArrived(true)
    // Сборка сайта — один раз после входа: дальше страницы приходят обычным
    // появлением, а не собираются заново на каждом переходе по меню.
    const timer = window.setTimeout(() => setArrived(false), 6000)
    return () => window.clearTimeout(timer)
  }, [])
  const pathname = usePathname()
  const motion = useNavigationMotion(pathname)
  useMagneticButtons()
  const me = useResource<CurrentUserDto>('/api/me')
  const groups = useMemo(() => (me.data ? navigationFor(me.data) : []), [me.data])
  const service = useMemo(() => (me.data ? serviceLinksFor(me.data) : []), [me.data])

  if (me.isLoading || (!me.data && !me.error)) {
    return (
      <div className={styles.shell} data-shell-loading>
        <div className={styles.header}>
          <Skeleton width="160px" height="24px" />
        </div>
        <main className={styles.main}>
          <Skeleton width="280px" height="30px" />
          <Skeleton height="120px" radius="20px" />
          <Skeleton height="320px" radius="20px" />
        </main>
      </div>
    )
  }

  if (me.error) {
    return (
      <main className={styles.main}>
        <ErrorState error={me.error} onRetry={me.reload} />
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button href={`/login?${REAUTH_PARAM}=1`} variant="primary">
            Войти заново
          </Button>
        </div>
      </main>
    )
  }

  const user = me.data as CurrentUserDto
  // Охранник по маршруту (пробел ТЗ «раздел недоступен», решение 153): страница
  // раздела, закрытого роли, вообще не монтируется — её запросы к API не уходят,
  // и вместо неё показывается «Раздел недоступен» тем же слоем, где обычно
  // рисуется содержимое страницы (шапка и меню остаются на месте).
  const sectionAllowed = isSectionAllowed(user, pathname)

  return (
    <CurrentUserProvider user={user}>
      <LiveBackground />
      <div className={arrived ? styles.arrival : undefined}>
      <Sidebar groups={groups} isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
      <div className={styles.shell}>
        {/* Линия перехода: щелчок принят, следующая страница уже в пути. */}
        <div className={styles.progress} data-active={motion.isLeaving || undefined} aria-hidden />
        <Header groups={groups} onMenuClick={() => setIsMenuOpen(true)} />
        <main className={styles.main}>
          {/*
            Ключ по адресу — это и есть переход между страницами: при смене
            адреса React пересоздаёт контейнер, и содержимое появляется заново
            снизу вверх, блок за блоком. Шапка и боковое меню при этом остаются
            на месте — приложение ощущается одним рабочим пространством
            (раздел 19 документа о движении).
          */}
          <div
            key={pathname}
            className={styles.page}
            data-page
          >
            {sectionAllowed ? children : <SectionUnavailable isUniversityRep={user.role === 'UNIVERSITY_REP'} />}
          </div>
        </main>
        <Footer service={service} />
      </div>
      </div>
      <MobileTabBar groups={groups} />
      <GlobalSearch />
    </CurrentUserProvider>
  )
}
