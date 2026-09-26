'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import type { AttachmentDto, AttachmentOwnerType } from '@/shared/contracts'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  Button,
  ErrorState,
  Icon,
  IconButton,
  MAX_ATTACHMENT_MB,
  Modal,
  SkeletonLines,
  apiDelete,
  apiUpload,
  formatDateTime,
  formatFileSize,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './Attachments.module.css'

const OWNER_PATH: Record<AttachmentOwnerType, string> = {
  DOCUMENT: 'documents',
  STAGE: 'workflow/stages',
}

export interface AttachmentsProps {
  ownerType: AttachmentOwnerType
  ownerId: string
  /**
   * Право загружать и удалять файлы — как у изменения самого владельца
   * (документа или этапа): `WRITE` на сервере (`attachments.service.ts`,
   * решение 145). Без него компонент только показывает список и скачивание.
   */
  canWrite: boolean
}

/**
 * Файлы документа или этапа (ТЗ, функц. требования п.3; решения 145 и 149).
 *
 * Список, скачивание, загрузка и удаление — поверх готового API решения 145.
 * Права и проверка формата и размера — целиком на сервере: этот компонент
 * лишь показывает список, отправляет файл и не подменяет отказ сервера своим
 * текстом (как карточка этапа не подменяет отказ workflow, решение 2).
 */
export function Attachments({ ownerType, ownerId, canWrite }: AttachmentsProps) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingDelete, setPendingDelete] = useState<AttachmentDto | null>(null)

  const basePath = `/api/${OWNER_PATH[ownerType]}/${ownerId}/files`
  const files = useResource<AttachmentDto[]>(basePath)

  const upload = useMutation(async (file: File) => (await apiUpload<AttachmentDto>(basePath, file)).data)
  const remove = useMutation(async (id: string) => (await apiDelete<{ id: string }>(`/api/files/${id}`)).data)

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Сбрасываем значение сразу: без этого повторный выбор того же файла
    // (например, после отказа сервера) не вызывает onChange во второй раз.
    event.target.value = ''
    if (!file) return
    const result = await upload.run(file)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`Файл «${result.data.originalName}» прикреплён`)
    files.reload()
  }

  async function onConfirmDelete() {
    if (!pendingDelete) return
    const result = await remove.run(pendingDelete.id)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Файл удалён')
    setPendingDelete(null)
    files.reload()
  }

  function closeDeleteModal() {
    remove.reset()
    setPendingDelete(null)
  }

  const rows = files.data ?? []

  return (
    <div className={styles.wrap}>
      {canWrite && (
        <div className={styles.uploadRow}>
          <input
            ref={inputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className={styles.hiddenInput}
            onChange={onPick}
            tabIndex={-1}
            aria-hidden="true"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="attach"
            onClick={() => inputRef.current?.click()}
            isLoading={upload.isPending}
          >
            Прикрепить файл
          </Button>
          <span className={styles.hint}>
            До {MAX_ATTACHMENT_MB} МБ · {ATTACHMENT_EXTENSIONS.join(', ')}
          </span>
        </div>
      )}

      {upload.error && (
        <p className={styles.refusal} role="alert">
          <Icon name="alert" size={20} />
          <span>
            <span className={styles.refusalTitle}>Файл не загружен</span>
            {upload.error.message}
          </span>
        </p>
      )}

      {files.isLoading ? (
        <SkeletonLines count={2} />
      ) : files.error ? (
        <ErrorState error={files.error} onRetry={files.reload} />
      ) : rows.length === 0 ? (
        <p className={styles.empty}>Файлов пока нет.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((attachment) => (
            <li key={attachment.id} className={styles.item}>
              <Icon name="document" size={20} className={styles.itemIcon} />
              <span className={styles.itemBody}>
                <span className={styles.itemName} title={attachment.originalName}>
                  {attachment.originalName}
                </span>
                <span className={styles.itemMeta}>
                  {formatFileSize(attachment.size)}
                  {attachment.uploadedBy ? ` · ${attachment.uploadedBy.fullName}` : ''} ·{' '}
                  {formatDateTime(attachment.uploadedAt)}
                </span>
              </span>
              <span className={styles.itemActions}>
                {/* Настоящая ссылка, а не кнопка с обработчиком: ответ сервера сам несёт
                    Content-Disposition: attachment, браузер сохраняет файл сам,
                    и по ссылке работает открытие в новой вкладке и «Сохранить как…». */}
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  href={`/api/files/${attachment.id}`}
                  external
                  title={`Скачать «${attachment.originalName}»`}
                >
                  Скачать
                </Button>
                {canWrite && (
                  <IconButton
                    icon="trash"
                    label={`Удалить файл «${attachment.originalName}»`}
                    size="sm"
                    onClick={() => setPendingDelete(attachment)}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <Modal
          isOpen
          onClose={closeDeleteModal}
          title="Удалить файл?"
          description={`«${pendingDelete.originalName}» — отменить это действие нельзя.`}
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={closeDeleteModal}>
                Отмена
              </Button>
              <Button variant="danger" onClick={onConfirmDelete} isLoading={remove.isPending}>
                Удалить
              </Button>
            </>
          }
        >
          {remove.error && (
            <p className={styles.refusal} role="alert">
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>Файл не удалён</span>
                {remove.error.message}
              </span>
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
