import { getIntegrationsConfig, TELEGRAM_MODE_VALUES, type TelegramConfig, type TelegramMode } from '../config'
import { decryptSecretValue, encryptSecretValue } from '@/shared/crypto/secret-box'
import { deleteSecret, findSecretValue, saveSecretValue } from '@/shared/db/system-secrets.repo'

/**
 * Токен бота, имя бота и режим приёма — из базы, если администратор их задавал
 * в админке (решение 142), иначе из env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
 * `TELEGRAM_MODE`). Токен в базе хранится зашифрованным (`shared/crypto/secret-box.ts`,
 * ключ — из AUTH_SECRET); имя бота и режим — как есть, это не секреты.
 *
 * Значения из базы держатся в памяти процесса (`loadRuntimeOverrides` — при старте,
 * `setBotToken`/`clearBotToken`/`setMode` — сразу после того, как их поменяла
 * админка), а не читаются на каждый запрос: `effectiveTelegramConfig()` вызывается
 * из синхронного кода (клиент Bot API, профиль), которому неоткуда взять `await`.
 * Порог этого решения — один экземпляр приложения (см. docs/SECURITY_LIMITATIONS.md):
 * второй узнает о смене токена или режима только после своего перезапуска или
 * следующего вызова `loadRuntimeOverrides`.
 *
 * Ключ шифрования (`secret`, обычно `resolveSecret()` из AUTH_SECRET) вызывающий
 * код передаёт сам, а не резолвится здесь: этот модуль лежит в слое интеграций
 * и не должен тянуть за собой NextAuth (`@/shared/auth/auth`) — тесты бизнес-логики
 * Telegram (`modules/telegram`), которые не мокают NextAuth, тогда падали бы
 * на импорте. Тот же приём — у `connect()` в `modules/telegram/telegram.service.ts`.
 */

export const TELEGRAM_BOT_TOKEN_SECRET_NAME = 'telegram.bot_token'
export const TELEGRAM_BOT_USERNAME_SECRET_NAME = 'telegram.bot_username'
export const TELEGRAM_MODE_SECRET_NAME = 'telegram.mode'

interface TokenOverride {
  botToken: string
  botUsername: string
}

let tokenOverride: TokenOverride | null = null
let modeOverride: TelegramMode | null = null
let loaded = false

/** Откуда действующий токен — для админки (GET /api/admin/telegram). */
export type TelegramTokenSource = 'database' | 'env' | 'none'

export function tokenSource(): TelegramTokenSource {
  if (tokenOverride) return 'database'
  return getIntegrationsConfig().telegram.botToken ? 'env' : 'none'
}

/** true — `loadRuntimeOverrides` уже отработал хотя бы раз в этом процессе. */
export function runtimeOverridesLoaded(): boolean {
  return loaded
}

/** Читает токен, имя бота и режим из базы в кеш процесса. Вызывается при старте (instrumentation.ts). */
export async function loadRuntimeOverrides(secret: string): Promise<void> {
  const [encryptedToken, username, mode] = await Promise.all([
    findSecretValue(TELEGRAM_BOT_TOKEN_SECRET_NAME),
    findSecretValue(TELEGRAM_BOT_USERNAME_SECRET_NAME),
    findSecretValue(TELEGRAM_MODE_SECRET_NAME),
  ])
  const token = encryptedToken ? decryptSecretValue(secret, encryptedToken) : null
  tokenOverride = token && username ? { botToken: token, botUsername: username } : null
  modeOverride = (TELEGRAM_MODE_VALUES as readonly string[]).includes(mode ?? '') ? (mode as TelegramMode) : null
  loaded = true
}

/** Конфигурация Telegram с учётом того, что задала админка. Синхронная — читает только кеш. */
export function effectiveTelegramConfig(): TelegramConfig {
  const base = getIntegrationsConfig().telegram
  const mode = modeOverride ?? base.mode
  if (!tokenOverride) return { ...base, mode }
  return {
    ...base,
    botToken: tokenOverride.botToken,
    botUsername: tokenOverride.botUsername,
    mode,
    enabled: Boolean(tokenOverride.botToken && tokenOverride.botUsername && base.webhookSecret),
  }
}

/** Сохранить новый токен (уже проверенный getMe) и обновить кеш немедленно. */
export async function setBotToken(secret: string, token: string, botUsername: string, adminId: string): Promise<void> {
  const encrypted = encryptSecretValue(secret, token)
  await Promise.all([
    saveSecretValue(TELEGRAM_BOT_TOKEN_SECRET_NAME, encrypted, adminId),
    saveSecretValue(TELEGRAM_BOT_USERNAME_SECRET_NAME, botUsername, adminId),
  ])
  tokenOverride = { botToken: token, botUsername }
}

/** Отключить бота: убрать токен из базы. Токен в env (если есть) продолжит действовать. */
export async function clearBotToken(): Promise<void> {
  await Promise.all([deleteSecret(TELEGRAM_BOT_TOKEN_SECRET_NAME), deleteSecret(TELEGRAM_BOT_USERNAME_SECRET_NAME)])
  tokenOverride = null
}

export async function setMode(mode: TelegramMode, adminId: string): Promise<void> {
  await saveSecretValue(TELEGRAM_MODE_SECRET_NAME, mode, adminId)
  modeOverride = mode
}

/** Только для тестов: сбросить кеш процесса между прогонами. */
export function resetRuntimeOverridesForTests(): void {
  tokenOverride = null
  modeOverride = null
  loaded = false
}
