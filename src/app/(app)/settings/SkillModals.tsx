'use client'

import { useState } from 'react'
import type { SkillDeletedDto, SkillDto, SkillMergeResultDto } from '@/shared/contracts'
import {
  Button,
  Icon,
  Input,
  Modal,
  RemoteSelect,
  Textarea,
  apiDelete,
  apiPatch,
  apiPost,
  fieldErrors,
  useMutation,
  useToast,
  type SelectOption,
} from '@/ui'
import styles from './admin.module.css'

/** Окна вкладки «Справочник навыков» (решение 107, право ADMIN): заведение,
 * правка, объединение дублей и удаление неиспользуемого навыка. */

function skillOption(row: SkillDto): SelectOption {
  return { value: row.id, label: `${row.name} — ${row.category}` }
}

export function CreateSkillModal({ onClose }: { onClose: (created: SkillDto | null) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')

  const save = useMutation(async () => {
    const result = await apiPost<SkillDto>('/api/skills', {
      name: name.trim(),
      category: category.trim(),
      description: description.trim() === '' ? null : description.trim(),
    })
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
    toast.success(`Навык «${result.data.name}» добавлен в справочник`)
    onClose(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title="Добавить навык"
      description="Навык попадёт в общий справочник — им можно будет привязать программы и продукты."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(null)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
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
        placeholder="Python"
        maxLength={120}
        autoFocus
      />
      <Input
        label="Категория"
        required
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        error={errorFor('category')}
        placeholder="Программирование"
        maxLength={100}
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

export function EditSkillModal({ skill, onClose }: { skill: SkillDto; onClose: (changed: boolean) => void }) {
  const toast = useToast()
  const [name, setName] = useState(skill.name)
  const [category, setCategory] = useState(skill.category)
  const [description, setDescription] = useState(skill.description ?? '')

  const save = useMutation(async () => {
    const result = await apiPatch<SkillDto>(`/api/skills/${skill.id}`, {
      name: name.trim(),
      category: category.trim(),
      description: description.trim() === '' ? null : description.trim(),
    })
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
    toast.success(`Навык «${result.data.name}» сохранён`)
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Изменить навык"
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={save.isPending}>
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
        maxLength={120}
        autoFocus
      />
      <Input
        label="Категория"
        required
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        error={errorFor('category')}
        maxLength={100}
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

/**
 * Объединение дубля навыка (решение 107): дубль удаляется, его связи с
 * программами, продуктами и рыночным спросом переходят на целевой навык.
 */
export function MergeSkillModal({ skill, onClose }: { skill: SkillDto; onClose: (merged: boolean) => void }) {
  const toast = useToast()
  const [targetId, setTargetId] = useState('')

  const merge = useMutation(async () => {
    const result = await apiPost<SkillMergeResultDto>(`/api/skills/${skill.id}/merge`, { targetId })
    return result.data
  })

  const errors = fieldErrors(merge.error)
  const errorFor = (field: string) => errors.find((item) => item.field === field)?.message ?? null

  async function submit() {
    if (targetId === '' || targetId === skill.id) return
    const result = await merge.run(undefined)
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    const { target, programs, products } = result.data
    toast.success(
      `«${skill.name}» объединён с «${target.name}»: программ перенесено ${programs.moved}, продуктов ${products.moved}`,
    )
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title={`Объединить «${skill.name}»`}
      description="Навык-дубль будет удалён, его программы, продукты, спрос и рекомендации перейдут на выбранный целевой навык."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={merge.isPending}
            disabled={targetId === '' || targetId === skill.id}
          >
            Объединить
          </Button>
        </>
      }
    >
      <RemoteSelect<SkillDto>
        label="Объединить в"
        required
        endpoint="/api/skills"
        params={{ sort: 'name' }}
        toOption={skillOption}
        searchPlaceholder="Название навыка"
        value={targetId}
        onValueChange={setTargetId}
        placeholder="Выберите навык-цель"
        error={targetId === skill.id ? 'Нельзя объединить навык сам с собой' : errorFor('targetId')}
      />
    </Modal>
  )
}

/** Удалить можно только навык, которым нигде не пользуются — сервер откажет остальным (409). */
export function DeleteSkillModal({ skill, onClose }: { skill: SkillDto; onClose: (deleted: boolean) => void }) {
  const toast = useToast()
  const inUse = skill.programCount > 0 || skill.productCount > 0

  const remove = useMutation(async () => (await apiDelete<SkillDeletedDto>(`/api/skills/${skill.id}`)).data)

  async function submit() {
    const result = await remove.run(undefined)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success(`Навык «${result.data.name}» удалён из справочника`)
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Удалить навык"
      description={`«${skill.name}» — ${skill.category}.`}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} isLoading={remove.isPending} disabled={inUse}>
            Удалить
          </Button>
        </>
      }
    >
      {inUse ? (
        <div className={styles.danger} role="alert">
          <Icon name="alert" size={16} />
          <p>
            Навык используется: программ — {skill.programCount}, продуктов — {skill.productCount}. Сначала уберите
            его из них или объедините с другим навыком.
          </p>
        </div>
      ) : (
        <p>Действие необратимо: навык пропадёт из справочника.</p>
      )}
      {remove.error && (
        <div className={styles.danger} role="alert">
          <Icon name="alert" size={16} />
          <p>{remove.error.message}</p>
        </div>
      )}
    </Modal>
  )
}
