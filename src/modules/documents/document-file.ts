import type { DocumentDto } from '@/shared/contracts/document'
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '@/shared/contracts/labels'
import { isPlaceholderReference } from '@/shared/utils/url'

/**
 * Файл документа и пакет документов связки (решение 212, п. 2).
 *
 * Эксперт не смог открыть подписанный пакет: у документа была только ссылка на
 * внешний файл (в демо — на несуществующий адрес), текста из шаблона нет, файлов
 * не приложено — открыть и скачать было нечего. Теперь у каждого документа в
 * любом статусе есть свой файл: реквизиты, текст (если собран из шаблона),
 * ссылка на оригинал и история статусов. Закрытие (подписан, в архиве, связка
 * завершена) запрещает только правку — чтение и скачивание открыты всегда.
 *
 * Формат — HTML-страница без скриптов: открывается в браузере, печатается
 * и сохраняется в PDF штатной печатью, читается без сторонних программ.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatRuDate(iso: string | null): string {
  if (!iso) return 'нет'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' }).format(
    new Date(iso),
  )
}

function formatRuDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(iso))
}

/** Имя файла без символов, которые ломают файловые системы и архивы. */
function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n\t\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'документ'
}

/** «Договор о сотрудничестве, версия 2 (Подписан).html» */
export function documentFileName(document: Pick<DocumentDto, 'title' | 'version' | 'status'>): string {
  return `${safeName(`${document.title}, версия ${document.version} (${DOCUMENT_STATUS_LABELS[document.status]})`)}.html`
}

/** Имя архива пакета: «Документы связки — КубГТУ — Информационные системы.zip». */
export function packageFileName(universityName: string | null, programName: string | null): string {
  const parts = ['Документы связки', universityName, programName].filter((part): part is string => Boolean(part))
  return `${safeName(parts.join(' — '))}.zip`
}

/** Папка документа внутри архива: номер держит порядок, имя — узнаваемость. */
export function packageFolderName(index: number, document: Pick<DocumentDto, 'title' | 'version'>): string {
  return `${String(index + 1).padStart(2, '0')} ${safeName(`${document.title}, версия ${document.version}`)}`
}

export interface DocumentFileAttachment {
  originalName: string
  size: number
}

/** HTML-файл документа: всё, что о нём известно системе, в читаемом и печатаемом виде. */
export function renderDocumentFile(document: DocumentDto, attachments: readonly DocumentFileAttachment[]): string {
  const links = document.links
  const rows: Array<[string, string]> = [
    ['Тип', DOCUMENT_TYPE_LABELS[document.type]],
    ['Версия', document.version],
    ['Статус', DOCUMENT_STATUS_LABELS[document.status]],
    ['Вуз', links.universityName ?? 'нет'],
    ['Программа', links.programName ?? 'нет'],
    ['Выдан', formatRuDate(document.issuedAt)],
    ['Подписан', formatRuDate(document.signedAt)],
    ['Автор', document.author?.fullName ?? 'нет'],
    ['Ответственный', document.responsible?.fullName ?? 'нет'],
  ]

  const reference = document.fileReference
  const referenceBlock = reference
    ? isPlaceholderReference(reference)
      ? `<p class="note">Ссылка на оригинал демонстрационная (${escapeHtml(reference)}) — файла по ней нет.</p>`
      : /^https?:\/\//i.test(reference)
        ? `<p><a href="${escapeHtml(reference)}">${escapeHtml(reference)}</a></p>`
        : `<p>${escapeHtml(reference)}</p>`
    : '<p class="note">Ссылки на оригинал во внешней системе нет.</p>'

  const body = document.content
    ? `<pre class="content">${escapeHtml(document.content)}</pre>`
    : '<p class="note">Текста в системе нет: документ заведён реквизитами и ссылкой на оригинал. Приложенные файлы скачиваются из карточки документа и входят в пакет документов связки.</p>'

  const files =
    attachments.length === 0
      ? '<p class="note">Файлов не приложено.</p>'
      : `<ul>${attachments
          .map((file) => `<li>${escapeHtml(file.originalName)} <span class="note">(${Math.max(1, Math.round(file.size / 1024))} КБ)</span></li>`)
          .join('')}</ul>`

  const history =
    document.history.length === 0
      ? '<p class="note">Статус не менялся.</p>'
      : `<ol>${document.history
          .map((entry) => {
            const transition = entry.fromStatus
              ? `${DOCUMENT_STATUS_LABELS[entry.fromStatus]} → ${DOCUMENT_STATUS_LABELS[entry.toStatus]}`
              : DOCUMENT_STATUS_LABELS[entry.toStatus]
            const comment = entry.comment ? ` — ${escapeHtml(entry.comment)}` : ''
            return `<li>${escapeHtml(transition)}, ${escapeHtml(formatRuDateTime(entry.changedAt))}, ${escapeHtml(entry.changedBy.fullName)}${comment}</li>`
          })
          .join('')}</ol>`

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}, версия ${escapeHtml(document.version)}</title>
<style>
  body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d1d22; max-width: 760px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .sub { color: #5b5b66; margin: 0 0 20px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; }
  dt { color: #5b5b66; }
  dd { margin: 0; }
  .content { white-space: pre-wrap; font: inherit; border-left: 3px solid #d6d3e8; padding: 4px 0 4px 16px; margin: 0; }
  .note { color: #5b5b66; }
  footer { margin-top: 36px; color: #8a8a94; font-size: 13px; }
  @media print { body { margin: 0 auto; } a { color: inherit; } }
</style>
</head>
<body>
<h1>${escapeHtml(document.title)}</h1>
<p class="sub">${escapeHtml(DOCUMENT_TYPE_LABELS[document.type])}, версия ${escapeHtml(document.version)}, статус «${escapeHtml(DOCUMENT_STATUS_LABELS[document.status])}»</p>
<dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>
<h2>Текст документа</h2>
${body}
<h2>Оригинал во внешней системе</h2>
${referenceBlock}
<h2>Приложенные файлы</h2>
${files}
<h2>История статусов</h2>
${history}
<footer>Выгружено из SkillLink ${escapeHtml(formatRuDateTime(new Date().toISOString()))}. Файл отражает данные системы на момент выгрузки.</footer>
</body>
</html>
`
}
