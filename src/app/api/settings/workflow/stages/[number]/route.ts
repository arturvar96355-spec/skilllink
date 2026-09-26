import { getCurrentUser } from '@/shared/auth/current-user'
import { handle, ok, parseBody } from '@/shared/http'
import { validationError } from '@/shared/http/errors'
import * as service from '@/modules/workflow/workflow-templates.service'
import { patchWorkflowStageTemplateSchema, workflowStageNumberSchema } from '@/modules/workflow/workflow-templates.schema'

type Context = { params: Promise<{ number: string }> }

/**
 * Переименовать этап шаблона и/или изменить нормативный срок (ТЗ, п. 4;
 * решение 146). Только ADMIN.
 *
 * Признак контрольной точки (`isControlPoint`) через это API не меняется:
 * правила порядка этапов (решения 5/28) завязаны на список номеров в коде,
 * и снятие признака здесь молча сломало бы их. Тело с этим полем отклоняется
 * явным объяснением, а не общей ошибкой «лишнее поле» — до разбора остальной
 * схемой, чтобы сообщение было понятным независимо от прочих полей тела.
 */
export const PATCH = handle<Context>(async (request, context) => {
  const user = await getCurrentUser()
  const { number } = await context.params
  const parsedNumber = workflowStageNumberSchema.safeParse(number)
  if (!parsedNumber.success) {
    throw validationError('Номер этапа от 1 до 14', [
      { field: 'number', message: 'Укажите число от 1 до 14' },
    ])
  }

  const raw = await request
    .clone()
    .json()
    .catch(() => null)
  if (raw !== null && typeof raw === 'object' && 'isControlPoint' in raw) {
    throw validationError('Признак контрольной точки нельзя изменить через это API', [
      {
        field: 'isControlPoint',
        message:
          'Только чтение: порядок этапов 6, 7, 11 завязан на код (решения 5/28, docs/CONTROL_POINTS.md). ' +
          'Через настройки можно поменять только название и нормативный срок',
      },
    ])
  }

  const input = await parseBody(request, patchWorkflowStageTemplateSchema)
  return ok(await service.patchStage(user, parsedNumber.data, input))
})
