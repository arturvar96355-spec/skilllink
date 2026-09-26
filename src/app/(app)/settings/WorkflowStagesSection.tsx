'use client'

import { useState } from 'react'
import type {
  WorkflowSettingsDto,
  WorkflowStageTemplateDto,
  WorkflowStageTemplatePatchResultDto,
} from '@/shared/contracts'
import {
  Badge,
  Button,
  Checkbox,
  ErrorState,
  Input,
  Modal,
  apiPatch,
  fieldErrors,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import { Row, RowsSkeleton } from './SettingsRow'
import { validateNormativeDays, validateStageTitle } from './workflow-stage-validation'
import settings from './settings.module.css'

/**
 * «Настройки → Этапы работы» (ТЗ, функц. требования пп. 6, 9; решение 146;
 * экран — решение 151). Хранимый шаблон 14 этапов, по которому строятся этапы
 * НОВЫХ связок: `GET/PATCH /api/settings/workflow[/stages/:number]`.
 *
 * Только ADMIN — так же, как API (`workflow-templates.service.ts`,
 * `assertCan(user, 'ADMIN')`). Раздел рисуется, только если он вообще есть
 * в колонке настроек (settings/page.tsx уже проверяет это `isAdmin`), поэтому
 * здесь прав второй раз не проверяем — как остальные вкладки администратора
 * («Пользователи», «Журнал действий»).
 *
 * Правится только название и нормативный срок — как разрешает сервер.
 * Признак «Контрольная точка» показывается, но не редактируется: правила
 * порядка этапов (решения 5/28) завязаны на номера в коде, снятие признака
 * здесь молча сломало бы проверку порядка, поэтому поле — только для чтения,
 * с тем же объяснением, что приходит с сервера.
 */
export function WorkflowStagesSection() {
  const toast = useToast()
  const workflow = useResource<WorkflowSettingsDto>('/api/settings/workflow')
  const [editing, setEditing] = useState<WorkflowStageTemplateDto | null>(null)

  function onSaved(result: WorkflowStageTemplatePatchResultDto) {
    setEditing(null)
    toast.success(
      result.appliedToStages > 0
        ? `Этап обновлён. Пересчитано незавершённых этапов уже заведённых связок: ${result.appliedToStages}`
        : 'Этап обновлён',
    )
    workflow.reload()
  }

  if (workflow.isLoading) return <RowsSkeleton count={6} />
  if (workflow.error) return <ErrorState error={workflow.error} onRetry={workflow.reload} />
  const rows = workflow.data?.stages ?? []

  return (
    <>
      <div className={workflow.isRefreshing ? settings.refreshing : undefined}>
        {rows.map((stage) => (
          <Row
            key={stage.stageNumber}
            title={
              <>
                {stage.stageNumber}. {stage.title}
                {stage.isControlPoint && (
                  <Badge tone="info" title={stage.controlPointExplanation ?? undefined}>
                    Контрольная точка
                  </Badge>
                )}
              </>
            }
            caption={`${stage.phaseLabel} · норматив ${stage.normativeDays} дн.`}
          >
            <Button size="sm" variant="secondary" onClick={() => setEditing(stage)}>
              Изменить
            </Button>
          </Row>
        ))}
      </div>

      <p className={settings.muted}>Новые процессы с нуля — в плане развития.</p>

      {editing && (
        <EditWorkflowStageModal stage={editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  )
}

function EditWorkflowStageModal({
  stage,
  onClose,
  onSaved,
}: {
  stage: WorkflowStageTemplateDto
  onClose: () => void
  onSaved: (result: WorkflowStageTemplatePatchResultDto) => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState(stage.title)
  const [normativeDays, setNormativeDays] = useState(String(stage.normativeDays))
  const [applyToUnfinishedStages, setApplyToUnfinishedStages] = useState(false)
  const [localErrors, setLocalErrors] = useState<{ title?: string; normativeDays?: string }>({})

  const submit = useMutation(
    async (body: { title: string; normativeDays: number; applyToUnfinishedStages: boolean }) => {
      const result = await apiPatch<WorkflowStageTemplatePatchResultDto>(
        `/api/settings/workflow/stages/${stage.stageNumber}`,
        body,
      )
      return result.data
    },
  )

  const serverErrors = fieldErrors(submit.error)
  const errorFor = (field: 'title' | 'normativeDays') =>
    localErrors[field] ?? serverErrors.find((item) => item.field === field)?.message ?? null

  async function onSave() {
    const titleResult = validateStageTitle(title)
    const daysResult = validateNormativeDays(normativeDays)
    if (!titleResult.ok || !daysResult.ok) {
      setLocalErrors({
        title: titleResult.ok ? undefined : titleResult.error,
        normativeDays: daysResult.ok ? undefined : daysResult.error,
      })
      return
    }
    setLocalErrors({})

    const result = await submit.run({
      title: titleResult.value,
      normativeDays: daysResult.value,
      applyToUnfinishedStages,
    })
    if (!result.ok) {
      if (result.error.code !== 'VALIDATION_ERROR') toast.error(result.error.message)
      return
    }
    onSaved(result.data)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Этап ${stage.stageNumber} — ${stage.phaseLabel}`}
      description="Правится только название и нормативный срок. Признак «Контрольная точка» задан в коде и здесь не меняется."
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={onSave} isLoading={submit.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Input
        label="Название этапа"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={errorFor('title')}
        maxLength={200}
      />
      <Input
        label="Норматив, дней"
        required
        type="number"
        min={1}
        max={3650}
        value={normativeDays}
        onChange={(event) => setNormativeDays(event.target.value)}
        error={errorFor('normativeDays')}
        hint="Считается от даты создания связки."
      />
      <Checkbox label="Контрольная точка" checked={stage.isControlPoint} disabled readOnly />
      <p className={settings.muted}>
        {stage.controlPointExplanation ??
          'Не контрольная точка. Признак задан в коде (решения 5/28) и через настройки не меняется.'}
      </p>
      <Checkbox
        label="Применить также к незавершённым этапам уже заведённых связок"
        checked={applyToUnfinishedStages}
        onChange={(event) => setApplyToUnfinishedStages(event.target.checked)}
      />
      <p className={settings.muted}>
        Без флажка правка коснётся только связок, заведённых после сохранения — уже открытые
        связки не изменятся.
      </p>
    </Modal>
  )
}
