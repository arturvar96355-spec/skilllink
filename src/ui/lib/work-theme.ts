/**
 * Спокойный вид рабочего режима — варианты на выбор владельца.
 *
 * Замечание эксперта: рабочий режим «аляпится» — много цветов и выделений,
 * ключевое не видно. Три варианта одной идеи «цвет — только сигнал»
 * (красный — требует внимания, жёлтый — ниже цели, фиолетовый — выбранное
 * и основное, остальное — нейтральные серые):
 *
 * - `a` — минимальный: токены рабочего режима и статусы словом с точкой, без
 *   плашек; зелёного «всё хорошо» нет; меньше рамок и теней. Разметка та же.
 * - `b` — строгий: всё из `a` плюс монохромные этапы (цвет только у просрочки
 *   и блокировки), графики одной светлотой фиолетового, тонкие разделители
 *   вместо карточек.
 * - `c` — графит: всё из `b` плюс нейтральный серый холст без фиолетового
 *   оттенка; фиолетовый остаётся только у выбранного, текущего этапа
 *   и основной кнопки, графики — серые, сигнал — красный и жёлтый.
 *
 * Вариант стоит атрибутом `data-work-theme` на `<html>` и действует только
 * вместе с `data-mode="work"`: презентационный режим не меняется.
 * Стили — `:global(html[data-mode='work'][data-work-theme]) …` (всё, что есть
 * в `a`), `…:is([data-work-theme='b'], [data-work-theme='c'])` (строгий
 * и графит), `…[data-work-theme='c']` (только графит).
 *
 * Включить выбранный вариант для всех — одна правка: `DEFAULT_WORK_THEME`.
 * Посмотреть вариант до решения — в консоли браузера
 * `localStorage.setItem('skilllink.workTheme.preview', 'b')` и обновить
 * страницу; `removeItem` — вернуть умолчание.
 */

export type WorkTheme = 'a' | 'b' | 'c'

/** `null` — рабочий режим как был, до выбора владельца. */
export const DEFAULT_WORK_THEME: WorkTheme | null = 'a'

/** Ключ предпросмотра в localStorage — только чтобы сравнить варианты вживую. */
export const WORK_THEME_PREVIEW_KEY = 'skilllink.workTheme.preview'

/** Атрибут на `<html>`, по которому стили различают варианты. */
export const WORK_THEME_ATTRIBUTE = 'data-work-theme'

/** Известное значение — вариант; `off` в предпросмотре — отключить; остальное — умолчание. */
export function parseWorkTheme(value: unknown): WorkTheme | null {
  if (value === 'a' || value === 'b' || value === 'c') return value
  if (value === 'off') return null
  return DEFAULT_WORK_THEME
}

/**
 * Скрипт до первой отрисовки — рядом со скриптом режима: вид не мигает, пока
 * грузится JavaScript. Сбой хранилища — вариант по умолчанию.
 */
export const WORK_THEME_BOOT_SCRIPT = `(function(){var t=${JSON.stringify(DEFAULT_WORK_THEME)};try{var v=localStorage.getItem('${WORK_THEME_PREVIEW_KEY}');if(v==='a'||v==='b'||v==='c'){t=v}else if(v==='off'){t=null}}catch(e){}if(t){document.documentElement.setAttribute('${WORK_THEME_ATTRIBUTE}',t)}})()`
