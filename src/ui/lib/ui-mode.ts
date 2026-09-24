/**
 * Режим интерфейса: «Рабочий» или «Презентационный» (решение 80).
 *
 * Рабочий — для ежедневной работы аналитика: реестры списком, на главной сразу
 * «Требует внимания», без заставки и декоративного движения. Презентационный —
 * весь визуал дизайнера (решения 70, 73, 79), как для показа.
 *
 * Выбор живёт в браузере (`localStorage`) и дублируется атрибутом `data-mode`
 * на `<html>` — по нему CSS прячет то, что можно спрятать без JavaScript.
 * Здесь — только чистые функции, без React: их проверяет тест, и тот же ключ
 * читает встроенный скрипт до первой отрисовки.
 */

export type UiMode = 'work' | 'showcase'

/** По умолчанию — рабочий, для всех ролей. */
export const DEFAULT_UI_MODE: UiMode = 'work'

/** Ключ в localStorage. */
export const UI_MODE_KEY = 'skilllink.uiMode'

/** Атрибут на `<html>`, по которому стили различают режимы. */
export const UI_MODE_ATTRIBUTE = 'data-mode'

export const UI_MODE_LABELS: Record<UiMode, string> = {
  work: 'Рабочий',
  showcase: 'Презентационный',
}

/** Хранилище в той мере, в какой оно нужно режиму: в тесте — подделка. */
export type UiModeStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Любое значение, кроме известного, — режим по умолчанию. */
export function parseUiMode(value: unknown): UiMode {
  return value === 'work' || value === 'showcase' ? value : DEFAULT_UI_MODE
}

/**
 * Режим из хранилища. Хранилища нет или оно бросает исключение (приватное окно,
 * запрет cookie) — рабочий режим: страница из-за этого не падает.
 */
export function readUiMode(storage: UiModeStorage | null | undefined): UiMode {
  if (!storage) return DEFAULT_UI_MODE
  try {
    return parseUiMode(storage.getItem(UI_MODE_KEY))
  } catch {
    return DEFAULT_UI_MODE
  }
}

/**
 * Запомнить режим. `false` — сохранить не удалось: выбор действует до
 * перезагрузки страницы, это допустимо.
 */
export function writeUiMode(storage: UiModeStorage | null | undefined, mode: UiMode): boolean {
  if (!storage) return false
  try {
    storage.setItem(UI_MODE_KEY, mode)
    return true
  } catch {
    return false
  }
}

/**
 * Скрипт до первой отрисовки: ставит `data-mode` на `<html>`, чтобы рабочий
 * режим не мигал визуалом презентационного, пока грузится JavaScript.
 * Стоит перед скриптом заставки — тот читает атрибут. Логика та же, что
 * у `readUiMode`: неизвестное значение или сбой хранилища — режим по умолчанию.
 */
export const UI_MODE_BOOT_SCRIPT = `(function(){var m='${DEFAULT_UI_MODE}';try{var v=localStorage.getItem('${UI_MODE_KEY}');if(v==='work'||v==='showcase'){m=v}}catch(e){}document.documentElement.setAttribute('${UI_MODE_ATTRIBUTE}',m)})()`
