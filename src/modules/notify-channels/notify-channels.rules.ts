/**
 * Команды MAX и VK — обычные русские слова, а не слэш-команды Telegram: у обеих
 * платформ принят диалог кнопками/текстом, не служебный синтаксис (решение 144).
 * Латинские алиасы оставлены на случай, если сотрудник напишет по привычке.
 */
const TODAY_WORDS = new Set(['сегодня', '/today', 'today'])
const STOP_WORDS = new Set(['стоп', '/stop', 'stop'])

export function parseChannelCommand(text: string | null | undefined): 'today' | 'stop' | 'unknown' {
  const normalized = (text ?? '').trim().toLowerCase()
  if (TODAY_WORDS.has(normalized)) return 'today'
  if (STOP_WORDS.has(normalized)) return 'stop'
  return 'unknown'
}

/** `/start <код>` в тексте сообщения — запасной путь, если платформа не передала код отдельным полем. */
export function extractStartCode(text: string | null | undefined): string | null {
  const match = /^\/start[@\w]*\s+(\S+)/.exec((text ?? '').trim())
  return match ? match[1] : null
}
