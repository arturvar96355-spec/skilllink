/**
 * Слои, которые закрываются по Escape, — стопкой: Escape закрывает только
 * верхний.
 *
 * Раньше каждый слой слушал клавишу сам. Выпадающий список внутри
 * модального окна закрывался по Escape вместе с окном — и форма «Создать
 * связку» пропадала со всем введённым. Теперь закрывается то, что открыто
 * последним: список, затем окно, затем то, что под ним.
 */

type Layer = { close: () => void }

const layers: Layer[] = []

/** Закрыть верхний слой. Возвращает, был ли что закрывать. */
export function closeTopLayer(): boolean {
  const top = layers[layers.length - 1]
  if (!top) return false
  top.close()
  return true
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && closeTopLayer()) event.preventDefault()
}

/** Положить слой наверх. Возвращает функцию, которая его убирает. */
export function pushEscapeLayer(close: () => void): () => void {
  const layer: Layer = { close }
  layers.push(layer)
  // Один слушатель на документ, пока открыт хотя бы один слой.
  if (layers.length === 1 && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown)
  }
  return () => {
    const index = layers.lastIndexOf(layer)
    if (index >= 0) layers.splice(index, 1)
    if (layers.length === 0 && typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown)
    }
  }
}
