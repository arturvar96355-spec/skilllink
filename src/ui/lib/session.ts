'use client'

import { signOut } from 'next-auth/react'
import { REAUTH_PARAM } from '@/shared/auth/reauth'

let isLeaving = false

/**
 * Уйти на вход, когда сервер ответил 401: снять старую сессию и запомнить,
 * куда человек шёл. Несколько запросов страницы получают 401 одновременно —
 * уход один.
 */
export async function leaveToLogin(): Promise<void> {
  if (isLeaving) return
  isLeaving = true

  try {
    await signOut({ redirect: false })
  } catch {
    // Не вышло снять cookie — не страшно: вход с параметром откроется и так,
    // а новая сессия заменит старую.
  }

  const from = window.location.pathname + window.location.search
  const query = new URLSearchParams({ [REAUTH_PARAM]: '1' })
  if (from !== '/' && !from.startsWith('/login')) query.set('from', from)
  // Полный переход, а не переход роутера: состояние страницы, собранное
  // для прежней сессии, уходить должно целиком.
  window.location.assign(`/login?${query.toString()}`)
}
