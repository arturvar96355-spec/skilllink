'use client'

import { useState } from 'react'
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  SKILL_IMPORTANCE,
  SKILL_IMPORTANCE_LABELS,
  SKILL_LEVELS,
  SKILL_LEVEL_LABELS,
  type ProgramDto,
  type ProgramSkillDto,
  type SkillDto,
} from '@/shared/contracts'
import {
  Button,
  Modal,
  RemoteSelect,
  Select,
  Textarea,
  apiPut,
  fieldErrors,
  useMutation,
  useToast,
  type SelectOption,
} from '@/ui'

function skillOption(row: SkillDto): SelectOption {
  return { value: row.id, label: `${row.name} — ${row.category}` }
}

/** Тело `PUT /api/programs/:id/skills` — полная замена набора навыков. */
function toSkillInput(skill: ProgramSkillDto) {
  return {
    skillId: skill.skillId,
    level: skill.level,
    importance: skill.importance,
    source: skill.source,
    confidence: skill.confidence,
    comment: skill.comment,
  }
}

/**
 * Привязка навыка к программе (решение 152, раздел ТЗ «Привязка навыков»).
 *
 * У API нет отдельного «добавить один навык» — только полная замена набора
 * (`PUT /api/programs/:id/skills`), поэтому окно берёт уже привязанные навыки
 * как есть и добавляет к ним один новый.
 */
export function AddProgramSkillModal({
  programId,
  existingSkills,
  onClose,
}: {
  programId: string
  existingSkills: ProgramSkillDto[]
  onClose: (added: boolean) => void
}) {
  const toast = useToast()

  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState<string>('BASIC')
  const [importance, setImportance] = useState<string>('MEDIUM')
  const [confidence, setConfidence] = useState('')
  const [comment, setComment] = useState('')

  const alreadyAdded = skillId !== '' && existingSkills.some((skill) => skill.skillId === skillId)

  const save = useMutation(async () => {
    const skills = [
      ...existingSkills.map(toSkillInput),
      {
        skillId,
        level,
        importance,
        // Навык привязан вручную из карточки, а не взят из учебного плана.
        source: 'MANUAL',
        confidence: confidence === '' ? null : confidence,
        comment: comment.trim() === '' ? null : comment.trim(),
      },
    ]
    const result = await apiPut<ProgramDto>(`/api/programs/${programId}/skills`, { skills })
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
    toast.success('Навык добавлен в программу')
    onClose(true)
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title="Добавить навык"
      description="Навык из общего справочника — с уровнем и важностью для этой программы."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={save.isPending}
            disabled={skillId === '' || alreadyAdded}
          >
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
        error={alreadyAdded ? 'Этот навык уже привязан к программе' : errorFor('skills')}
      />
      <Select
        label="Уровень"
        value={level}
        onValueChange={setLevel}
        options={SKILL_LEVELS.map((value) => ({ value, label: SKILL_LEVEL_LABELS[value] }))}
      />
      <Select
        label="Важность"
        value={importance}
        onValueChange={setImportance}
        options={SKILL_IMPORTANCE.map((value) => ({ value, label: SKILL_IMPORTANCE_LABELS[value] }))}
      />
      <Select
        label="Доверие к оценке"
        value={confidence}
        onValueChange={setConfidence}
        placeholder="Не указано"
        options={CONFIDENCE_LEVELS.map((value) => ({ value, label: CONFIDENCE_LABELS[value] }))}
      />
      <Textarea
        label="Комментарий"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={500}
      />
    </Modal>
  )
}
