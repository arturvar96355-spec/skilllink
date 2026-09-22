'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CurrentUserDto } from '@/shared/contracts'

/**
 * Текущий пользователь во всём интерфейсе.
 *
 * Запрашивается один раз в каркасе приложения и раздаётся вниз: по роли
 * решается, какие разделы вообще показывать, а какие запрещены. Каждая
 * страница, спрашивающая `/api/me` заново, — это лишний запрос и риск
 * показать разное в шапке и в боковом меню.
 */
const CurrentUserContext = createContext<CurrentUserDto | null>(null)

export function CurrentUserProvider({
  user,
  children,
}: {
  user: CurrentUserDto
  children: ReactNode
}) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUserDto {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('useCurrentUser вызван вне CurrentUserProvider')
  return user
}

/** Представитель вуза: у него другой состав разделов и свой кабинет. */
export function isUniversityRep(user: CurrentUserDto): boolean {
  return user.role === 'UNIVERSITY_REP'
}
