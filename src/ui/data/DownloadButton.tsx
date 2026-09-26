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
  onDownloaded,
  method,
  body,
  disabled,
}: {
  href: string
  /** Имя файла, если сервер его не прислал. */
  fallbackName: string
  children: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  title?: string
  /**
   * Файл скачан. Нужен, когда скачивание — ещё и действие на сервере
   * (выгрузка «всё о субъекте» закрывает открытый запрос субъекта, решение 116):
   * список запросов после неё стоит перечитать.
   */
  onDownloaded?: (filename: string) => void
  /** По умолчанию `GET`. `POST` — когда серверу нужно тело запроса (файл для LMS, решение 182). */
  method?: 'GET' | 'POST'
  body?: BodyInit
  disabled?: boolean
}) {
  const toast = useToast()
  const [isLoading, setIsLoading] = useState(false)

  async function onClick() {
    if (isLoading) return
    setIsLoading(true)
    try {
      const { filename } = await apiDownload(href, fallbackName, method || body ? { method, body } : undefined)
      toast.success(`Файл «${filename}» скачан`)
      onDownloaded?.(filename)
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Не удалось скачать файл. Попробуйте ещё раз.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      icon="download"
      onClick={onClick}
      isLoading={isLoading}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  )
}
