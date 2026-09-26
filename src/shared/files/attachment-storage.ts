import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveUploadsDir } from '@/shared/config/attachments.config'
import { log } from '@/shared/log/logger'

/**
 * Файлы на диске сервера (решение 145): в контейнере — том Docker
 * (`UPLOADS_DIR=/data/uploads`), локально — `./.uploads` (в .gitignore).
 *
 * Имя на диске — случайный ключ, не исходное имя файла (ТЗ, п.3): оригинальное имя
 * приходит от пользователя и может быть чем угодно (путь, управляющие символы, чужое
 * расширение); ключ ничего не открывает, кроме этого одного файла. Ключ шардируется
 * первыми двумя символами в подкаталог — чтобы не копить тысячи файлов в одной папке.
 */

function randomKey(): string {
  return randomBytes(24).toString('hex')
}

/** `ab/ab12…` — сам ключ уже несёт путь внутри каталога загрузок. */
function shardedKey(key: string): string {
  return `${key.slice(0, 2)}/${key}`
}

export interface StoredFile {
  storageKey: string
}

/** Записывает файл на диск под новым случайным ключом и возвращает его. */
export async function writeAttachmentFile(bytes: Uint8Array): Promise<StoredFile> {
  const storageKey = shardedKey(randomKey())
  const fullPath = join(resolveUploadsDir(), storageKey)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, bytes)
  return { storageKey }
}

/**
 * Читает файл по ключу из базы (доверенное значение — путь не приходит от пользователя).
 * Отсутствие файла на диске при существующей записи в базе — рассинхронизация
 * (файл стёрли вручную, диск подменили): наружу это должно выглядеть как внутренняя
 * ошибка, а не «файл не найден», — запись в базе есть, значит файл обязан быть.
 */
export async function readAttachmentFile(storageKey: string): Promise<Buffer> {
  const fullPath = join(resolveUploadsDir(), storageKey)
  try {
    return await readFile(fullPath)
  } catch (error) {
    log.error('[ATTACHMENTS] файл есть в базе, но не найден на диске', { storageKey, err: error })
    throw error
  }
}

/** Удаление идемпотентно: файла уже нет — не ошибка (повторный запрос, гонка). */
export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  const fullPath = join(resolveUploadsDir(), storageKey)
  try {
    await unlink(fullPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      log.error('[ATTACHMENTS] не удалось удалить файл с диска', { storageKey, err: error })
    }
  }
}

/**
 * Безопасное имя для заголовка `Content-Disposition`: без переводов строк и кавычек,
 * которые сломали бы заголовок или подменили его параметры (CRLF- и заголовок-инъекции).
 * ASCII-часть — понятный запасной вариант для клиентов без RFC 6266; `filename*` — точное
 * имя в UTF-8 для остальных (там же кириллица большинства файлов пользователей).
 */
export function contentDisposition(originalName: string): string {
  const stripped = originalName.replace(/[\r\n\u0000-\u001f"\\]/g, '').trim()
  const safeName = stripped.length > 0 ? stripped : 'file'
  const ascii = safeName.replace(/[^\x20-\x7e]/g, '_').slice(0, 150) || 'file'
  const encoded = encodeURIComponent(safeName)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
