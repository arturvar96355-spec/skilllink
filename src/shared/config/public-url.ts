/**
 * Публичный адрес стенда для ссылок в сообщениях ботов (решения 102, 200): AUTH_URL
 * (адрес за прокси, его видит человек), иначе APP_BASE_URL. Ни того ни другого —
 * null: сообщение уходит без ссылок, а не со ссылкой на localhost.
 */
export function publicBaseUrl(): string | null {
  const raw = process.env.AUTH_URL?.trim() || process.env.APP_BASE_URL?.trim() || ''
  try {
    return raw ? new URL(raw).origin : null
  } catch {
    return null
  }
}

/** Полная ссылка на страницу SkillLink по пути из `src/ui/lib/links.ts`; без адреса стенда — null. */
export function publicUrl(path: string): string | null {
  const base = publicBaseUrl()
  return base ? `${base}${path}` : null
}
