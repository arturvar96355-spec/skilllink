import { join, isAbsolute } from 'node:path'

/**
 * Файлы, прикладываемые к документам и этапам (решение 145, ТЗ функц. требования п.3:
 * «Возможность прикладывания файлов в статусы в форматах png, jpeg, pdf, zip, gzip, rar,
 * doc, docx, xls, xlsx»).
 *
 * Расширение — ровно этот список из ТЗ, без добавлений (например, без «jpg»: в ТЗ
 * дословно только «jpeg»). Проверяется и расширение имени файла, и сигнатура содержимого
 * (magic bytes) — так подмена расширения (переименовали .exe в .png) не проходит.
 */
export const ATTACHMENT_ALLOWED_EXTENSIONS = [
  'png',
  'jpeg',
  'pdf',
  'zip',
  'gzip',
  'rar',
  'doc',
  'docx',
  'xls',
  'xlsx',
] as const

export type AttachmentExtension = (typeof ATTACHMENT_ALLOWED_EXTENSIONS)[number]

/**
 * Больше этого файл не принимается (решение 145). Пример из задания — 20 МБ; число здесь,
 * а не в разбросе по коду, чтобы Caddyfile и тест согласованности сверялись с одним местом
 * (src/shared/config/deploy-consistency.test.ts).
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024 // 20 МБ, TEMP

/**
 * Каталог хранения файлов на диске. В контейнере — том Docker (`/data/uploads`,
 * docker-compose.yml), локально — `./.uploads` в рабочей копии (в .gitignore).
 * Переменная окружения задаёт путь явно — так совпадают код, docker-compose.yml
 * и docs/DEPLOY.md.
 */
export function resolveUploadsDir(cwd: string = process.cwd()): string {
  const raw = process.env.UPLOADS_DIR?.trim()
  const path = raw && raw.length > 0 ? raw : './.uploads'
  return isAbsolute(path) ? path : join(cwd, path)
}

/** Расширение из имени файла: нижним регистром, без точки; нет точки — пустая строка. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function isAllowedExtension(extension: string): extension is AttachmentExtension {
  return (ATTACHMENT_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Сигнатуры файлов (magic bytes) — по группам, которые указаны в задании:
 * PNG, JPEG, PDF, ZIP/DOCX/XLSX (общий формат — PK), GZIP (1F8B), RAR, старые
 * DOC/XLS (D0CF11E0, формат Microsoft OLE Compound File).
 *
 * Каждая запись — один из допустимых префиксов байт содержимого для расширения.
 * У расширения без сигнатуры (не бывает в этом списке) проверка отсутствовала бы —
 * поэтому тест (attachments.rules.test.ts) сверяет, что сигнатура задана для каждого
 * расширения из ATTACHMENT_ALLOWED_EXTENSIONS.
 */
const PK = [0x50, 0x4b] // 'P' 'K' — общий заголовок ZIP-контейнера (ZIP, DOCX, XLSX).
export const ATTACHMENT_SIGNATURES: Record<AttachmentExtension, readonly number[][]> = {
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  jpeg: [[0xff, 0xd8, 0xff]],
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // "%PDF-"
  zip: [
    [...PK, 0x03, 0x04],
    [...PK, 0x05, 0x06], // пустой архив
    [...PK, 0x07, 0x08], // архив с данными после записи (spanned)
  ],
  gzip: [[0x1f, 0x8b]],
  rar: [
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], // RAR 1.5–4.0
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], // RAR 5.0+
  ],
  doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  docx: [
    [...PK, 0x03, 0x04],
    [...PK, 0x05, 0x06],
    [...PK, 0x07, 0x08],
  ],
  xls: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  xlsx: [
    [...PK, 0x03, 0x04],
    [...PK, 0x05, 0x06],
    [...PK, 0x07, 0x08],
  ],
}

/** Содержимое файла начинается с одной из допустимых сигнатур расширения. */
export function matchesSignature(extension: AttachmentExtension, bytes: Uint8Array): boolean {
  const signatures = ATTACHMENT_SIGNATURES[extension]
  return signatures.some(
    (signature) => bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte),
  )
}

/**
 * Content-Type для скачивания — по расширению, которое уже подтверждено сигнатурой
 * (решение 173, жёсткое ревью, проблема 16). Раньше сохранялся `file.type` со слов
 * браузера/клиента как есть; на практике безобидно (расширение — из белого списка,
 * `Content-Disposition: attachment` не даёт браузеру открыть файл как страницу), но
 * доверять клиенту то, что сервер и так надёжно определяет сам, — лишний риск без
 * причины. Одно значение на расширение — файл уже прошёл `assertValidAttachment`,
 * так что более узкое сопоставление (различать `.doc`/`.xls` бинарно) не нужно.
 */
export const ATTACHMENT_MIME_TYPES: Record<AttachmentExtension, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gzip: 'application/gzip',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** Content-Type по расширению, уже проверенному `assertValidAttachment` — не по словам клиента. */
export function mimeForExtension(extension: AttachmentExtension): string {
  return ATTACHMENT_MIME_TYPES[extension]
}
