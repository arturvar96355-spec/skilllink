'use client'

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
  apiPatch,
  fieldErrors,
  useMutation,
  useToast,
} from '@/ui'

/**
 * Правка карточки вуза (решение 152, пробел ТЗ РТК: карточки должны
 * изменяться, а не только создаваться).
 *
 * Поля — те же, что в `CreateUniversityModal`: остальные (адрес, ИНН, ОГРН,
 * счётчики) заводятся отдельно и здесь не трогаются. Проверка — на сервере,
 * форма только показывает, к какому полю относится отказ.
 */
export function EditUniversityModal({
  university,
  onClose,
}: {
  university: UniversityDto
  onClose: (changed: boolean) => void
}) {
  const toast = useToast()

  const [name, setName] = useState(university.name)
  const [shortName, setShortName] = useState(university.shortName ?? '')
  const [city, setCity] = useState(university.city)
  const [region, setRegion] = useState(university.region)
  const [status, setStatus] = useState<string>(university.status)
  const [website, setWebsite] = useState(university.website ?? '')
  const [description, setDescription] = useState(university.description ?? '')

  const update = useMutation(async (body: Record<string, unknown>) => {
    const result = await apiPatch<UniversityDto>(`/api/universities/${university.id}`, body)
    return result.data
  })

  const errors = fieldErrors(update.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const result = await update.run({
      name: name.trim(),
      shortName: shortName.trim() === '' ? null : shortName.trim(),
      city: city.trim(),
      region: region.trim(),
      status,
      website: website.trim() === '' ? null : website.trim(),
      description: description.trim() === '' ? null : description.trim(),
    })

    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }

    toast.success(`Вуз «${result.data.name}» изменён`)
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Изменить вуз"
      description="Адрес, ИНН, ОГРН и контакты правятся отдельно в карточке."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={update.isPending}>
            Сохранить
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
      />
      <Select
        label="Статус сотрудничества"
        value={status}
        onValueChange={setStatus}
        options={UNIVERSITY_STATUSES.filter((value) => value !== 'ARCHIVED').map((value) => ({
          value,
          label: UNIVERSITY_STATUS_LABELS[value],
        }))}
        error={errorFor('status')}
        hint="Архивация и возврат — отдельными кнопками в карточке."
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
