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

/**
 * Адрес, на котором ещё идёт сцена входа, после перехода на `pathname`.
 *
 * Сцена живёт только на странице, куда человек пришёл со входа. Ушёл с неё —
 * сцена кончилась насовсем: иначе при возвращении на эту страницу сборка
 * проигрывалась бы заново и главная «пересобиралась» при каждом заходе
 * (решение 194).
 */
export function arrivalAfterNavigation(arrivedAt: string | null, pathname: string): string | null {
  return arrivedAt === pathname ? arrivedAt : null
}

/** Части каркаса и страницы, которые собираются в сцене входа (`.arrival` в Shell.module.css). */
export const ARRIVAL_PARTS = 'aside, header, [data-page] > *, [data-assemble]'

/** Метка части, чья сборка уже сыграла: CSS снимает с неё анимацию входа. */
export const ASSEMBLED_ATTRIBUTE = 'data-assembled'

/**
 * Отметить часть, у которой закончилась анимация сборки (по `animationend`).
 *
 * Анимация входа висит на селекторах, которые зависят от соседей: номер блока
 * (`:nth-child`) задаёт задержку, а `:has([data-assemble])` — какую сборку
 * блок получает. Когда данные догружаются и перед блоком встаёт новый (бегущая
 * строка над живой полосой), браузер пересчитывает сыгранную анимацию, и она
 * играет снова — блок пропадает и появляется. Отмеченная часть из сборки
 * выходит: конец анимации совпадает с обычным видом блока, снятие ничего не
 * меняет на экране.
 */
export function markAssembled(target: unknown): boolean {
  if (!isElementLike(target) || !target.matches(ARRIVAL_PARTS)) return false
  target.setAttribute(ASSEMBLED_ATTRIBUTE, '')
  return true
}

interface ElementLike {
  matches: (selector: string) => boolean
  setAttribute: (name: string, value: string) => void
}

function isElementLike(target: unknown): target is ElementLike {
  return (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as ElementLike).matches === 'function' &&
    typeof (target as ElementLike).setAttribute === 'function'
  )
}
