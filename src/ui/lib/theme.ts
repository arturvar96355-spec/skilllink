/**
 * Тема интерфейса: тёмная или светлая (решение 122).
 *
 * Как на большинстве сайтов: пока человек сам не выбрал, тема следует системной
 * (`prefers-color-scheme`); выбор переключателем запоминается в браузере и
 * дальше главнее системы. Тема — атрибут `data-theme` на `<html>`: по нему
 * `globals.css` подменяет токены цвета. Здесь — чистые функции без React:
 * их проверяет тест, и тот же ключ читает скрипт до первой отрисовки.
 */

export type Theme = 'dark' | 'light'

/** Ключ в localStorage. Нет значения — тема системы. */
export const THEME_KEY = 'skilllink.theme'

/** Атрибут на `<html>`, по которому стили различают темы. */
export const THEME_ATTRIBUTE = 'data-theme'

export const THEME_LABELS: Record<Theme, string> = {
  dark: 'Тёмная',
  light: 'Светлая',
}

export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Сохранённый выбор или `null`, если человек тему не выбирал. */
export function readStoredTheme(storage: ThemeStorage | null | undefined): Theme | null {
  if (!storage) return null
  try {
    const value = storage.getItem(THEME_KEY)
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

/** Тема к показу: выбор человека, иначе системная; системы нет — тёмная (фирменная). */
export function resolveTheme(stored: Theme | null, systemPrefersLight: boolean): Theme {
  return stored ?? (systemPrefersLight ? 'light' : 'dark')
}

/** `false` — сохранить не удалось: тема действует до перезагрузки. */
export function writeTheme(storage: ThemeStorage | null | undefined, theme: Theme): boolean {
  if (!storage) return false
  try {
    storage.setItem(THEME_KEY, theme)
    return true
  } catch {
    return false
  }
}

/**
 * Скрипт до первой отрисовки: ставит `data-theme`, чтобы светлая тема не мигала
 * тёмной, пока грузится JavaScript. Логика та же, что у `resolveTheme`.
 */
export const THEME_BOOT_SCRIPT = `(function(){var t=null;try{var v=localStorage.getItem('${THEME_KEY}');if(v==='dark'||v==='light'){t=v}}catch(e){}if(!t){try{t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){t='dark'}}document.documentElement.setAttribute('${THEME_ATTRIBUTE}',t)})()`
