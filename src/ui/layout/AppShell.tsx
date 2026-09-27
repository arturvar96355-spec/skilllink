'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { REAUTH_PARAM } from '@/shared/auth/reauth'
import type { ApprovalListMetaDto, CurrentUserDto } from '@/shared/contracts'
import { Button } from '../primitives/Button'
import { Skeleton } from '../primitives/Skeleton'
import { ErrorState, SectionUnavailable } from '../data/States'
import { GlobalSearch } from '../search/GlobalSearch'
import { useResource } from '../hooks/useResource'
import { CurrentUserProvider } from './CurrentUser'
import { Footer } from './Footer'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { APPROVALS_CHANGED_EVENT, approvalsCount } from './approvals-badge'
import { canSeeApprovals, isSectionAllowed, navigationFor, serviceLinksFor } from './navigation'
import { arrivalAfterNavigation, markAssembled, takeArrival } from './arrival'
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
  const pathname = usePathname()
  // Первое открытие после входа: меню и шапка дописывают сцену входа (07, раздел 18).
  // Сцена держится, пока человек на странице, куда пришёл со входа: снять её
  // по таймеру нельзя — у блоков страницы своё появление, и при смене анимации
  // браузер проиграл бы его заново: через несколько секунд после входа всё
  // на миг пропадало. Ушёл со страницы — сцена кончилась насовсем, и при
  // возвращении страница приходит обычным появлением (решение 194).
  const [arrivedAt, setArrivedAt] = useState<string | null>(null)
  const [assembling, setAssembling] = useState(false)
  useEffect(() => {
    if (!takeArrival()) return
    setArrivedAt(window.location.pathname)
    setAssembling(true)
  }, [])
  useEffect(() => {
    setArrivedAt((current) => arrivalAfterNavigation(current, pathname))
  }, [pathname])
  // Размытие под шапкой выключено только пока летят блоки: его возврат ничего не перезапускает.
  useEffect(() => {
    if (!assembling) return
    const timer = window.setTimeout(() => setAssembling(false), 6000)
    return () => window.clearTimeout(timer)
  }, [assembling])
  const arrived = arrivedAt === pathname
  // Часть собралась — из сборки она выходит и больше её не повторяет, что бы
  // ни догрузилось рядом (arrival.ts, markAssembled).
  // Слушает документ, а не обёртку сцены: пока грузится текущий пользователь,
  // обёртки ещё нет, а сцена уже началась.
  useEffect(() => {
    if (!arrived) return
    const onEnd = (event: AnimationEvent) => markAssembled(event.target)
    document.addEventListener('animationend', onEnd)
    return () => document.removeEventListener('animationend', onEnd)
  }, [arrived])
  const motion = useNavigationMotion(pathname)
  useMagneticButtons()
  const me = useResource<CurrentUserDto>('/api/me')
  // Число у «Согласований» (решение 218): ждут моего решения и мои согласованные,
  // которые осталось выполнить. Эксперту — нет: решать он не может.
  const approvals = useResource<unknown[]>(
    me.data && canSeeApprovals(me.data) && !me.data.isReviewer ? '/api/admin/approvals?scope=awaiting&pageSize=1' : null,
  )
  const reloadApprovals = approvals.reload
  // Перечитываем при смене раздела и после решения на экране «Согласований».
  const approvalsPath = useRef(pathname)
  useEffect(() => {
    if (approvalsPath.current === pathname) return
    approvalsPath.current = pathname
    reloadApprovals()
  }, [pathname, reloadApprovals])
  useEffect(() => {
    window.addEventListener(APPROVALS_CHANGED_EVENT, reloadApprovals)
    return () => window.removeEventListener(APPROVALS_CHANGED_EVENT, reloadApprovals)
  }, [reloadApprovals])
  const approvalsBadge = approvalsCount(approvals.meta as ApprovalListMetaDto | null)
  const groups = useMemo(
    () => (me.data ? navigationFor(me.data, { approvals: approvalsBadge }) : []),
    [me.data, approvalsBadge],
  )
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
      <div className={[arrived && styles.arrival, arrived && assembling && styles.assembling].filter(Boolean).join(' ') || undefined}>
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
