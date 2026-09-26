/**
 * Определение вуза по адресу отправителя — код, без модели (решение 170).
 *
 * Сравнение идёт по домену: сайт вуза (`University.website`) и почты контактных
 * лиц (`Contact.email`) дают набор доменов, которые считаются «доменом вуза».
 * Личная почта на общем провайдере (`@gmail.com`, `@mail.ru` и так далее) никого
 * не выдаёт — совпадение только по доменам, которые сам вуз уже указал в базе.
 */

/** Домен адреса в нижнем регистре; `null` — не похоже на почту. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at === -1 || at === email.length - 1) return null
  return email.slice(at + 1).trim().toLowerCase() || null
}

/** Домен из ссылки на сайт — без протокола, `www.` и пути. */
export function domainFromWebsite(website: string): string | null {
  const trimmed = website.trim()
  if (!trimmed) return null
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase() || null
  } catch {
    return null
  }
}

/** Общие бесплатные почтовые провайдеры — совпадение по ним ничего не значит. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'yandex.ru', 'yandex.com', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'rambler.ru', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com', 'ya.ru', 'protonmail.com',
])

export interface UniversityDomainCandidate {
  universityId: string
  domains: readonly string[]
}

/**
 * Первый вуз, чей набор доменов (сайт + почты контактов) содержит домен отправителя.
 * `null` — домен отправителя не определён, это общий провайдер, или совпадений нет.
 */
export function matchUniversityByDomain(
  senderEmail: string,
  candidates: readonly UniversityDomainCandidate[],
): string | null {
  const domain = emailDomain(senderEmail)
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null
  for (const candidate of candidates) {
    if (candidate.domains.includes(domain)) return candidate.universityId
  }
  return null
}
