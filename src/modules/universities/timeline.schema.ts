import { z } from '@/shared/zod'
import { TIMELINE } from '@/shared/config/data-quality.config'
import { TIMELINE_EVENT_TYPES } from '@/shared/contracts/data-quality'

/** `types=stage,meeting` или `types=stage&types=meeting`. */
const typesSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.enum(TIMELINE_EVENT_TYPES)))

export const timelineQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(TIMELINE.maxLimit).default(TIMELINE.defaultLimit),
  types: typesSchema.optional(),
})

export type TimelineQuery = z.infer<typeof timelineQuerySchema>
