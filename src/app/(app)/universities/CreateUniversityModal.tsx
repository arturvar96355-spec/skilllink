'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  UNIVERSITY_STATUSES,
  UNIVERSITY_STATUS_LABELS,
  type UniversityDto,
} from '@/shared/contracts'
import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
  apiPost,
  fieldErrors,
  universityHref,
  useMutation,
  useToast,
} from '@/ui'

/**
 * Заведение вуза в реестр — главное действие страницы (раздел 20 шаблона).
 *
 * Поля ровно те, что принимает `POST /api/universities`; проверка остаётся
 * за сервером, а форма только показывает, к какому полю относится отказ.
 * Дублировать правила проверки на клиенте нельзя: они разойдутся.
 */
export function CreateUniversityModal({ onClose }: { onClose: (created: boolean) => void }) {
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('Россия')
  const [status, setStatus] = useState<string>('NEW')
  const [website, setWebsite] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPost<UniversityDto>('/api/universities', body)
    return result.data
  })

  const errors = fieldErrors(create.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const result = await create.run({
      name: name.trim(),
      shortName: shortName.trim() === '' ? null : shortName.trim(),
      city: city.trim(),
      region: region.trim(),
      status,
      website: website.trim() === '' ? null : website.trim(),
      description: description.trim() === '' ? null : description.trim(),
    })

    if (!result.ok) {
      // Ошибку валидации показываем под полями; остальное — сообщением.
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }

    toast.success(`Вуз «${result.data.name}» заведён`)
    onClose(true)
    router.push(universityHref(result.data.id))
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Добавить вуз"
      description="Минимум — название, город и регион. Остальное можно заполнить позже в карточке."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={create.isPending}>
            Добавить
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
        placeholder="Санкт-Петербургский государственный университет телекоммуникаций"
        autoFocus
      />
      <Input
        label="Краткое название"
        value={shortName}
        onChange={(event) => setShortName(event.target.value)}
        error={errorFor('shortName')}
        hint="Показывается в таблицах и на значке вуза: СПбГУТ, МТУСИ."
      />
      <Input
        label="Город"
        required
        value={city}
        onChange={(event) => setCity(event.target.value)}
        error={errorFor('city')}
      />
      <Input
        label="Регион"
        required
        value={region}
        onChange={(event) => setRegion(event.target.value)}
        error={errorFor('region')}
        hint="Для вузов федерального значения оставьте «Россия»."
      />
      <Select
        label="Статус сотрудничества"
        value={status}
        onValueChange={setStatus}
        options={UNIVERSITY_STATUSES.map((value) => ({
          value,
          label: UNIVERSITY_STATUS_LABELS[value],
        }))}
        error={errorFor('status')}
      />
      <Input
        label="Сайт"
        type="url"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
        error={errorFor('website')}
        placeholder="https://example.ru"
      />
      <Textarea
        label="Описание"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={errorFor('description')}
        maxLength={2000}
      />
    </Modal>
  )
}
