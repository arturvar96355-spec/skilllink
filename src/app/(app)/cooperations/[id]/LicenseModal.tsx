'use client'

import { useState } from 'react'
import { TRANSFER_STATUSES, TRANSFER_STATUS_LABELS, type CooperationDto } from '@/shared/contracts'
import { Button, Input, Modal, Select, Textarea, apiPatch, fieldErrors, useMutation, useToast } from '@/ui'
import { buildLicensePatch, licenseFormValues } from './license'

/**
 * Форма блока «Лицензия и передача ПО» карточки связки (решение 150).
 *
 * Поля появились в связке решением 145 («Каталог по ТЗ»), но правились только
 * через `/api-docs` или curl. Здесь — тот же `PATCH /api/cooperations/:id`,
 * что и у остальных полей связки: отдельного эндпоинта под них нет и не нужно.
 */
export function LicenseModal({
  cooperation,
  onClose,
}: {
  cooperation: CooperationDto
  onClose: (updated: CooperationDto | null) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState(() => licenseFormValues(cooperation))

  const save = useMutation(async () => {
    const result = await apiPatch<CooperationDto>(
      `/api/cooperations/${cooperation.id}`,
      buildLicensePatch(form),
    )
    return result.data
  })

  const errors = fieldErrors(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    const result = await save.run(undefined)
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    toast.success('Лицензия и передача ПО обновлены')
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Лицензия и передача ПО"
      description="Реквизиты договора и статус передачи продукта вузу — колонки «Каталога по ТЗ». Вендор и ПО берутся из выбранного продукта связки."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Input
        label="Номер договора"
        value={form.contractNumber}
        onChange={(event) => setForm((current) => ({ ...current, contractNumber: event.target.value }))}
        maxLength={100}
        error={errorFor('contractNumber')}
      />

      <Input
        label="Подписание лицензии"
        type="date"
        value={form.licenseSignedAt}
        onChange={(event) => setForm((current) => ({ ...current, licenseSignedAt: event.target.value }))}
        error={errorFor('licenseSignedAt')}
      />

      <Input
        label="Срок действия лицензии (год)"
        type="number"
        min={1}
        max={10}
        step={1}
        inputMode="numeric"
        value={form.licenseTermYears}
        onChange={(event) => setForm((current) => ({ ...current, licenseTermYears: event.target.value }))}
        error={errorFor('licenseTermYears')}
        hint="Пустое поле — «Нет данных»: значение будет стёрто, а не обнулено."
      />

      <Select
        label="Статус по передаче"
        value={form.transferStatus}
        onValueChange={(value) => setForm((current) => ({ ...current, transferStatus: value }))}
        placeholder="Не указан"
        options={TRANSFER_STATUSES.map((value) => ({ value, label: TRANSFER_STATUS_LABELS[value] }))}
        error={errorFor('transferStatus')}
      />

      <Textarea
        label="Комментарий"
        value={form.comment}
        onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
        maxLength={2000}
        error={errorFor('comment')}
      />
    </Modal>
  )
}
