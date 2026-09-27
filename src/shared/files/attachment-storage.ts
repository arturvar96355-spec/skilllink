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

/** Заголовок `Content-Disposition` — общий с отчётами и выгрузками, `shared/http/content-disposition.ts`. */
export { contentDisposition } from '@/shared/http/content-disposition'
