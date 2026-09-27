/**
 * Ссылка-заглушка (решение 212): домены, зарезервированные RFC 2606 и RFC 6761
 * для примеров, никогда никуда не ведут. Такую ссылку честнее показать текстом
 * с пометкой, чем дать по ней щёлкнуть и получить ошибку браузера.
 */
export function isPlaceholderReference(reference: string | null | undefined): boolean {
  if (!reference) return false
  try {
    const host = new URL(reference).hostname.toLowerCase()
    return (
      host === 'invalid' ||
      host.endsWith('.invalid') ||
      host === 'example.com' ||
      host.endsWith('.example.com') ||
      host === 'example.org' ||
      host === 'example.net' ||
      host.endsWith('.example')
    )
  } catch {
    return false
  }
}
