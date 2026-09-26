'use client'

import { useState } from 'react'
import {
  PRODUCT_SKILL_RELEVANCE,
  PRODUCT_SKILL_RELEVANCE_LABELS,
  type ProductDto,
  type ProductSkillDto,
  type SkillDto,
} from '@/shared/contracts'
import { Button, Modal, RemoteSelect, Select, apiPut, fieldErrors, useMutation, useToast, type SelectOption } from '@/ui'

function skillOption(row: SkillDto): SelectOption {
  return { value: row.id, label: `${row.name} — ${row.category}` }
}

/** Тело `PUT /api/products/:id/skills` — полная замена набора навыков. */
function toSkillInput(skill: ProductSkillDto) {
  return { skillId: skill.skillId, relevance: skill.relevance }
}

/**
 * Привязка навыка к IT-продукту (задача «Данные без экрана», пункт 4) —
 * по образцу `AddProgramSkillModal` (решение 152): у API тоже нет отдельного
 * «добавить один навык», только полная замена набора
 * (`PUT /api/products/:id/skills`), поэтому окно берёт уже привязанные
 * навыки как есть и добавляет к ним один новый.
 */
export function AddProductSkillModal({
  productId,
  existingSkills,
  onClose,
}: {
  productId: string
  existingSkills: ProductSkillDto[]
  onClose: (added: boolean) => void
}) {
  const toast = useToast()

  const [skillId, setSkillId] = useState('')
  const [relevance, setRelevance] = useState<string>('CORE')

  const alreadyAdded = skillId !== '' && existingSkills.some((skill) => skill.skillId === skillId)

  const save = useMutation(async () => {
    const skills = [...existingSkills.map(toSkillInput), { skillId, relevance }]
    const result = await apiPut<ProductDto>(`/api/products/${productId}/skills`, { skills })
    return result.data
  })

  const errors = fieldErrors(save.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    if (skillId === '' || alreadyAdded) return
    const result = await save.run(undefined)
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    toast.success('Навык добавлен в продукт')
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Добавить навык"
      description="Навык из общего справочника — с тем, насколько он ключевой для этого продукта."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending} disabled={skillId === '' || alreadyAdded}>
            Добавить
          </Button>
        </>
      }
    >
      <RemoteSelect<SkillDto>
        label="Навык"
        required
        endpoint="/api/skills"
        params={{ sort: 'name' }}
        toOption={skillOption}
        searchPlaceholder="Название навыка"
        value={skillId}
        onValueChange={setSkillId}
        placeholder="Выберите навык"
        error={alreadyAdded ? 'Этот навык уже привязан к продукту' : errorFor('skills')}
      />
      <Select
        label="Значимость"
        value={relevance}
        onValueChange={setRelevance}
        options={PRODUCT_SKILL_RELEVANCE.map((value) => ({ value, label: PRODUCT_SKILL_RELEVANCE_LABELS[value] }))}
      />
    </Modal>
  )
}
