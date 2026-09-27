import type { ChannelId, UserDto } from '@/shared/contracts'

const MESSENGER_TITLES: Record<ChannelId, string> = { telegram: 'Telegram', max: 'MAX', vk: 'ВКонтакте' }

/**
 * Куда дойдёт уведомление о назначении (решение 210): на стенде проверяющий ждал
 * сообщения в Telegram у сотрудника, у которого Telegram не был подключён, — окно
 * должно сказать это до сохранения. `messenger` сервер отдаёт только тому, кто
 * назначает; поля нет — строки нет.
 */
export function deliveryNotice(user: Pick<UserDto, 'messenger'> | undefined): string | null {
  if (!user || user.messenger === undefined) return null
  return user.messenger
    ? `Уведомление придёт в колокольчик SkillLink и в ${MESSENGER_TITLES[user.messenger]}.`
    : 'Мессенджер у сотрудника не подключён — уведомление будет только в колокольчике SkillLink.'
}
