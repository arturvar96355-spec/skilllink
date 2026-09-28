'use client'

import { useState } from 'react'
import { Button } from '../primitives/Button'
import { useToast } from '../overlays/Toast'

/**
 * Кнопка «PNG» у диаграммы (ТЗ фронта 28.09, Ф6). Сама картинка собирается
 * функцией `onExport` (src/ui/lib/chart-png.ts): кнопка отвечает только за
 * «готовим / готово / ошибка», как `DownloadButton` у выгрузок.
 */
export function ChartPngButton({ onExport, title }: { onExport: () => Promise<string>; title: string }) {
  const toast = useToast()
  const [isLoading, setIsLoading] = useState(false)

  async function onClick() {
    if (isLoading) return
    setIsLoading(true)
    try {
      const fileName = await onExport()
      toast.success(`Картинка «${fileName}» скачана`)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Не удалось собрать картинку диаграммы.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button variant="ghost" size="sm" icon="download" onClick={onClick} isLoading={isLoading} title={`«${title}» картинкой PNG`}>
      PNG
    </Button>
  )
}
