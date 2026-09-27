/**
 * Безопасное имя для заголовка `Content-Disposition`: без переводов строк и кавычек,
 * которые сломали бы заголовок или подменили его параметры (CRLF- и заголовок-инъекции).
 * ASCII-часть — понятный запасной вариант для клиентов без RFC 6266; `filename*` — точное
 * имя в UTF-8 для остальных (там же кириллица большинства файлов пользователей).
 *
 * Вынесено из `attachment-storage.ts` (решение 210): тем же заголовком теперь
 * отдаются отчёты и выгрузки реестров — Safari берёт имя из `filename*`.
 */
export function contentDisposition(originalName: string): string {
  const stripped = originalName.replace(/[\r\n\u0000-\u001f"\\]/g, '').trim()
  const safeName = stripped.length > 0 ? stripped : 'file'
  const ascii = safeName.replace(/[^\x20-\x7e]/g, '_').slice(0, 150) || 'file'
  const encoded = encodeURIComponent(safeName)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
