'use client'

import { useCallback, useRef } from 'react'

/**
 * Печать одного блока с диаграммой среди нескольких на странице (решение 172,
 * ТЗ — функц. требование 1, «выгрузка диаграмм в png/pdf»).
 *
 * Приём `[data-print-document]` (globals.css, решение 97) на печати прячет всё,
 * кроме элемента с этим атрибутом, — у отчётов такой элемент один на странице
 * и стоит постоянно. На главной и в аналитике диаграмм несколько, поэтому
 * атрибут ставится на нужный блок только на время печати — прямой правкой DOM
 * в обход React, чтобы значение точно попало в дерево до вызова `window.print()`,
 * а не после следующего рендера.
 */
export function usePrintBlock<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  const print = useCallback(() => {
    const node = ref.current
    if (!node) return

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      node.removeAttribute('data-print-document')
      window.removeEventListener('afterprint', cleanup)
    }

    node.setAttribute('data-print-document', '')
    window.addEventListener('afterprint', cleanup)
    window.print()
    // Подстраховка: не все браузеры шлют `afterprint` при отмене печати вкладки.
    setTimeout(cleanup, 2000)
  }, [])

  return { ref, print }
}
