import { z } from '@/shared/zod'
import { CONTROL_STAGE_NUMBER } from '@/shared/config/workflow.config'

/**
 * `PATCH /api/settings/workflow/stages/{number}` (ТЗ, функц. требования пп. 6, 9;
 * решение 146). Только название и нормативный срок — признак контрольной точки
 * через это API не меняется (см. WorkflowStageTemplateDto.controlPointExplanation).
 *
 * `isControlPoint` в теле — не просто игнорируется: наличие этого ключа отдельно
 * проверяется в route.ts до разбора схемой и отклоняется понятным объяснением,
 * а не общей ошибкой «лишнее поле».
 */
export const patchWorkflowStageTemplateSchema = z
  .object({
    title: z.string().trim().min(1, 'Укажите название').max(200, 'Не длиннее 200 символов').optional(),
    normativeDays: z.coerce
      .number()
      .int('Целое число дней')
      .min(1, 'Не меньше 1 дня')
      .max(3650, 'Не больше 3650 дней')
      .optional(),
    /**
     * Применить новый нормативный срок к уже заведённым связкам, у которых этот
     * этап ещё не завершён и не отменён (пересчитывается от даты создания связки).
     * Без этого поля (по умолчанию false) существующие связки не меняются —
     * так и требует ТЗ: правка шаблона касается только новых.
     */
    applyToUnfinishedStages: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.normativeDays !== undefined, {
    message: 'Не передано ни одного поля для изменения — доступны title и normativeDays',
  })

export type PatchWorkflowStageTemplateInput = z.infer<typeof patchWorkflowStageTemplateSchema>

/** Номер этапа в пути — 1..14, как WorkflowStageTemplate.stageNumber. */
export const workflowStageNumberSchema = z.coerce
  .number()
  .int('Номер этапа — целое число')
  .min(1, 'Номер этапа от 1 до 14')
  .max(CONTROL_STAGE_NUMBER, 'Номер этапа от 1 до 14')
