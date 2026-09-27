/**
 * Хоть одно значение отличается от значения по умолчанию — кнопка «Сбросить
 * фильтры» показывается. На каждом экране раньше писалось своё перечисление
 * `a !== '' || b !== ''`, и при следующем фильтре условие легко было забыть
 * дополнить; здесь — одна проверка на всех. Значение по умолчанию — пустая
 * строка, если для поля не задано другое (`status: 'OPEN'`, `criticalOnly: false`).
 * Отложенный поиск (`useDebounced`) сюда не передаётся: кнопка должна появляться
 * по введённому символу, а не после паузы (решение 128).
 *
 * Без JSX и в своём файле, а не в `ResetFilters.tsx`: модуль с JSX не проходит
 * через vitest (esbuild не умеет `jsx: preserve` из tsconfig Next.js) — так же
 * вынесены `report-table.ts` и `audit-view.ts` рядом со своими экранами.
 */
export function hasActiveFilters<T extends Record<string, unknown>>(
  values: T,
  defaults: { [K in keyof T]?: T[K] } = {},
): boolean {
  return (Object.keys(values) as (keyof T)[]).some((key) => {
    if (key in defaults) return values[key] !== defaults[key]
    const value = values[key]
    // Без явного значения по умолчанию: флажок по умолчанию снят, остальное — пустая строка.
    return value !== (typeof value === 'boolean' ? false : '')
  })
}
