import { assertCan } from '@/shared/auth/permissions'
import { writeAudit } from '@/shared/audit/audit'
import { AI_LETTER_INSTRUCTION } from '@/shared/config/ai-assist.config'
import { deleteSecret, saveSecretValue } from '@/shared/db/system-secrets.repo'
import { log } from '@/shared/log/logger'
import type { CurrentUser } from '@/shared/auth/current-user'
import type { AiLetterInstructionDto } from '@/shared/contracts/ai-assist'
import * as repo from './ai-assist.repo'
import { LETTER_SAFETY_RULES } from './ai-assist.prompts'
import type { LetterInstructionInput } from './ai-assist.schema'

/**
 * Инструкция администратора для писем вузу (решение 213): тон, подпись, что
 * обязательно упоминать, чего избегать. Подставляется в системный промпт
 * генерации и переделки писем (`letterRulesTail`, ai-assist.prompts.ts) — перед
 * базовыми правилами, которые она не отменяет.
 *
 * Хранится в `system_secrets` открытым значением — тем же механизмом, что имя
 * бота и режим приёма Telegram (решение 142): настройка меняется без перезапуска
 * и без новой таблицы. Читать и менять — только администратору; каждое изменение
 * пишется в журнал действий без самого текста (длина до и после): инструкция —
 * свободный текст, и в ней может оказаться чьё-то имя.
 */

function toDto(row: Awaited<ReturnType<typeof repo.findLetterInstruction>>): AiLetterInstructionDto {
  return {
    text: row?.value ?? '',
    isDefault: row === null,
    maxLength: AI_LETTER_INSTRUCTION.maxLength,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedByName: row?.updatedByName ?? null,
    baseRules: [...LETTER_SAFETY_RULES],
  }
}

/**
 * Для генерации писем: текст инструкции или null. Не бросает — если настройку
 * не удалось прочитать, письмо пишется по базовым правилам, а не падает.
 */
export async function loadLetterInstruction(): Promise<string | null> {
  try {
    const row = await repo.findLetterInstruction(AI_LETTER_INSTRUCTION.settingName)
    return row?.value.trim() ? row.value : null
  } catch (error) {
    log.warn('[AI] инструкция для писем не прочитана — письмо по базовым правилам', { err: error })
    return null
  }
}

export async function getLetterInstruction(user: CurrentUser): Promise<AiLetterInstructionDto> {
  assertCan(user, 'ADMIN')
  return toDto(await repo.findLetterInstruction(AI_LETTER_INSTRUCTION.settingName))
}

/** Сохранить инструкцию. Пустой текст — вернуть по умолчанию. */
export async function updateLetterInstruction(
  user: CurrentUser,
  input: LetterInstructionInput,
): Promise<AiLetterInstructionDto> {
  assertCan(user, 'ADMIN')
  const text = input.text.trim()
  if (text === '') return resetLetterInstruction(user)

  const before = await repo.findLetterInstruction(AI_LETTER_INSTRUCTION.settingName)
  if (before?.value === text) return toDto(before)

  await saveSecretValue(AI_LETTER_INSTRUCTION.settingName, text, user.id)
  await writeAudit({
    userId: user.id,
    action: 'ai.letter_instruction.update',
    objectType: 'SystemSecret',
    objectId: AI_LETTER_INSTRUCTION.settingName,
    payload: { length: text.length, previousLength: before?.value.length ?? 0 },
  })
  return toDto(await repo.findLetterInstruction(AI_LETTER_INSTRUCTION.settingName))
}

/** «Вернуть по умолчанию»: инструкции нет, письма пишутся по базовым правилам. */
export async function resetLetterInstruction(user: CurrentUser): Promise<AiLetterInstructionDto> {
  assertCan(user, 'ADMIN')
  const removed = await deleteSecret(AI_LETTER_INSTRUCTION.settingName)
  // Сбрасывать нечего — и в журнал писать нечего: повторное нажатие ничего не меняет.
  if (removed) {
    await writeAudit({
      userId: user.id,
      action: 'ai.letter_instruction.reset',
      objectType: 'SystemSecret',
      objectId: AI_LETTER_INSTRUCTION.settingName,
      payload: {},
    })
  }
  return toDto(null)
}
