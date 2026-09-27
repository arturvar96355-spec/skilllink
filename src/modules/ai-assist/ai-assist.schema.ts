import { z } from '@/shared/zod'
import { AI_LETTER_INSTRUCTION, AI_REWRITE } from '@/shared/config/ai-assist.config'
import { AI_REWRITE_STYLES, AI_REWRITE_TARGET_TYPES } from '@/shared/contracts/ai-assist'

/**
 * Тела запросов ИИ-помощника к письмам (решение 213).
 */

/** Управляющие символы, кроме перевода строки и табуляции: в тексте для людей им не место. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/

/** `POST /api/ai/rewrite` — переделать черновик письма по кнопке. */
export const aiRewriteSchema = z.object({
  target: z.object({
    type: z.enum(AI_REWRITE_TARGET_TYPES),
    id: z.string().trim().min(1).max(64),
  }),
  text: z
    .string()
    .trim()
    .min(1, 'Черновик пустой — переделывать нечего')
    .max(AI_REWRITE.maxTextLength, `Черновик длиннее ${AI_REWRITE.maxTextLength} знаков — сократите его вручную`),
  style: z.enum(AI_REWRITE_STYLES),
})

export type AiRewriteInput = z.infer<typeof aiRewriteSchema>

/**
 * `PUT /api/settings/ai-letter-instruction` — инструкция администратора для писем.
 * Пустой текст — то же, что «Вернуть по умолчанию».
 */
export const letterInstructionSchema = z.object({
  text: z
    .string()
    .trim()
    .max(
      AI_LETTER_INSTRUCTION.maxLength,
      `Инструкция длиннее ${AI_LETTER_INSTRUCTION.maxLength} знаков — оставьте главное: тон, подпись, что упоминать и чего избегать`,
    )
    .refine((text) => !CONTROL_CHARS.test(text), 'В инструкции есть служебные символы — вставьте текст без них'),
})

export type LetterInstructionInput = z.infer<typeof letterInstructionSchema>
