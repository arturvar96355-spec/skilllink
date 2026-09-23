/**
 * Метка «пришли со входа»: экран входа ставит её перед переходом, каркас
 * приложения читает один раз и продолжает сцену — меню проявляется от левого
 * края (07, раздел 18). Отдельный модуль без зависимостей: его читают и вход,
 * и каркас.
 */
export const ARRIVAL_KEY = 'skilllink:arrival'

/** Забрать метку: true — это первое открытие после входа. */
export function takeArrival(): boolean {
  try {
    const value = window.sessionStorage.getItem(ARRIVAL_KEY)
    window.sessionStorage.removeItem(ARRIVAL_KEY)
    return value === '1'
  } catch {
    return false
  }
}
