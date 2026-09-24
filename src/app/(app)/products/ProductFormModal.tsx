'use client'

import { useState } from 'react'
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  type ProductDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
  apiPatch,
  apiPost,
  fieldErrors,
  useMutation,
  useToast,
  type ApiRequestError,
} from '@/ui'

type FieldError = ReturnType<typeof fieldErrors>[number]

/**
 * Поля, к которым сервер привязал отказ.
 *
 * Кроме ошибок валидации это конфликты с полем в `details`: дубль названия
 * и версия продукта с открытыми связками. Их текст показывается под полем —
 * человек видит, что исправить, а не общее сообщение в углу экрана.
 */
function rejectedFields(error: ApiRequestError | null): FieldError[] {
  if (error?.code !== 'CONFLICT') return fieldErrors(error)
  if (!Array.isArray(error.details)) return []
  return error.details.filter(
    (item): item is FieldError =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FieldError).field === 'string' &&
      typeof (item as FieldError).message === 'string',
  )
}

/** Пустое поле формы — это «не заполнено» (null), а не пустая строка в базе. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Заведение и правка IT-продукта — одна форма.
 *
 * Поля ровно те, что принимают `POST /api/products` и `PATCH /api/products/:id`;
 * проверка остаётся за сервером, а форма только показывает, к какому полю
 * относится отказ. При правке уходят только изменённые поля: неизменённая
 * версия не должна упираться в правило про открытые связки.
 */
export function ProductFormModal({
  product,
  onClose,
}: {
  /** Есть — правка этого продукта, нет — заведение нового. */
  product?: ProductDto
  onClose: (saved: ProductDto | null) => void
}) {
  const toast = useToast()
  const isEdit = product !== undefined

  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [version, setVersion] = useState(product?.version ?? '')
  const [status, setStatus] = useState<string>(product?.status ?? 'ACTIVE')
  const [documentationUrl, setDocumentationUrl] = useState(product?.documentationUrl ?? '')
  const [description, setDescription] = useState(product?.description ?? '')

  const save = useMutation(async (body: Record<string, unknown>) => {
    const result = product
      ? await apiPatch<ProductDto>(`/api/products/${product.id}`, body)
      : await apiPost<ProductDto>('/api/products', body)
    return result.data
  })

  const errors = rejectedFields(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const values: Record<string, unknown> = {
      name: name.trim(),
      category: category.trim(),
      version: orNull(version),
      status,
      documentationUrl: orNull(documentationUrl),
      description: orNull(description),
    }

    const body = product
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) => value !== product[key as keyof ProductDto],
          ),
        )
      : values

    if (product && Object.keys(body).length === 0) {
      toast.info('Изменений нет')
      onClose(null)
      return
    }

    const result = await save.run(body)
    if (!result.ok) {
      // Отказ, привязанный к полю, уже виден под ним; остальное — сообщением.
      if (rejectedFields(result.error).length === 0) toast.error(result.error.message)
      return
    }

    toast.success(
      isEdit
        ? `Продукт «${result.data.name}» сохранён`
        : `Продукт «${result.data.name}» добавлен в реестр`,
    )
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title={isEdit ? 'Изменить продукт' : 'Добавить продукт'}
      description={
        isEdit
          ? undefined
          : 'Минимум — название и категория. После добавления продукт можно выбрать в связке.'
      }
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
            {isEdit ? 'Сохранить' : 'Добавить'}
          </Button>
        </>
      }
    >
      <Input
        label="Название"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errorFor('name')}
        placeholder="Платформа видеоконференций"
        autoFocus
      />
      <Input
        label="Категория"
        required
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        error={errorFor('category')}
        placeholder="Облачные сервисы"
      />
      <Input
        label="Версия"
        value={version}
        onChange={(event) => setVersion(event.target.value)}
        error={errorFor('version')}
        placeholder="1.0"
        hint={
          isEdit && product.cooperationCount > 0
            ? 'Связкам в работе новую версию передаёт выпуск версии — правкой карточки её не поменять.'
            : undefined
        }
      />
      <Select
        label="Статус"
        value={status}
        onValueChange={setStatus}
        options={PRODUCT_STATUSES.map((value) => ({ value, label: PRODUCT_STATUS_LABELS[value] }))}
        error={errorFor('status')}
      />
      <Input
        label="Документация"
        type="url"
        value={documentationUrl}
        onChange={(event) => setDocumentationUrl(event.target.value)}
        error={errorFor('documentationUrl')}
        placeholder="https://docs.example.ru/product"
        hint="Адрес с http:// или https://."
      />
      <Textarea
        label="Описание"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={errorFor('description')}
        rows={3}
      />
    </Modal>
  )
}
