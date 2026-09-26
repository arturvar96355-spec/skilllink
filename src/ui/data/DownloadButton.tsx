'use client'

import { useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from '../primitives/Button'
import { useToast } from '../overlays/Toast'
import { ApiRequestError, apiDownload } from '../lib/api'

/**
 * Кнопка выгрузки файла: реестры («Выгрузить») и отчёты по ТЗ («Скачать CSV/XLSX/JSON»).
 *
 * Раньше это была ссылка на файл: пока сервер собирал выгрузку, ничего не
 * происходило, а ошибка открывалась сырым JSON в новой вкладке. ТЗ дизайна
 * 26–29.09 (п. 2.2) требует «подготовки, успеха и ошибки» — здесь все три:
 * крутилка на кнопке, сообщение с именем файла, русский текст ошибки сервера.
 * Вид — обычная `Button`: новой кнопки в дизайн-системе не появляется.
 */
export function DownloadButton({
  href,
  fallbackName,
  children,
  variant = 'secondary',
  size,
  title,
}: {
  href: string
  /** Имя файла, если сервер его не прислал. */
  fallbackName: string
  children: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  title?: string
}) {
  const toast = useToast()
  const [isLoading, setIsLoading] = useState(false)

  async function onClick() {
    if (isLoading) return
    setIsLoading(true)
    try {
      const { filename } = await apiDownload(href, fallbackName)
      toast.success(`Файл «${filename}» скачан`)
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Не удалось скачать файл. Попробуйте ещё раз.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button variant={variant} size={size} icon="download" onClick={onClick} isLoading={isLoading} title={title}>
      {children}
    </Button>
  )
}
