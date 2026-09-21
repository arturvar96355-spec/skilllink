import { z } from '@/shared/zod'
import { paginationSchema } from '@/shared/http/pagination'
import { MEETING_FORMATS } from '@/shared/contracts/enums'

const isoDate = z.iso.datetime({ message: 'Дата должна быть в формате ISO 8601' })

export const MEETING_SORT_FIELDS = ['date', 'createdAt', 'updatedAt'] as const

export const meetingListQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  cooperationId: z.string().trim().min(1).optional(),
  universityId: z.string().trim().min(1).optional(),
  programId: z.string().trim().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.string().optional(),
})

export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>

/**
 * Участник встречи: сотрудник, контактное лицо вуза либо внешний человек по имени.
 * Ровно одно из трёх — иначе непонятно, кто участвовал.
 */
export const meetingParticipantSchema = z
  .object({
    userId: z.string().trim().min(1).nullish(),
    contactId: z.string().trim().min(1).nullish(),
    externalName: z.string().trim().min(2).max(200).nullish(),
  })
  .refine(
    (value) =>
      [value.userId, value.contactId, value.externalName].filter(
        (item) => item !== null && item !== undefined,
      ).length === 1,
    { message: 'Укажите ровно одно: сотрудника, контактное лицо или имя внешнего участника' },
  )

/** База без значений по умолчанию: `.partial()` их не снимает. */
const meetingFields = {
  date: isoDate,
  topic: z.string().trim().min(3, 'Тема должна содержать не менее 3 символов').max(300),
  format: z.enum(MEETING_FORMATS),
  result: z.string().trim().max(2000).nullish(),
  nextAction: z.string().trim().max(1000).nullish(),
  nextActionDueAt: isoDate.nullish(),
  responsibleId: z.string().trim().min(1, 'Укажите ответственного'),
}

export const createMeetingSchema = z.object({
  cooperationId: z.string().trim().min(1).nullish(),
  universityId: z.string().trim().min(1).nullish(),
  programId: z.string().trim().min(1).nullish(),
  ...meetingFields,
  format: z.enum(MEETING_FORMATS).default('ONLINE'),
  participants: z.array(meetingParticipantSchema).max(50).optional(),
})

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>

export const updateMeetingSchema = z
  .object({ ...meetingFields, participants: z.array(meetingParticipantSchema).max(50) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Не передано ни одного поля для изменения',
  })

export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>
