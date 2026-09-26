import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { validationError } from '@/shared/http/errors'

/**
 * Минимальный ZIP для файлов Excel (решение 122).
 *
 * Файл .xlsx — это ZIP-архив с XML внутри. Библиотека ради этого была бы новой
 * зависимостью (CLAUDE.md: только с объяснением), а нужно немного: записать
 * десяток файлов и прочитать архив, который сохранил Excel или LibreOffice.
 * Сжатие и распаковка — `node:zlib` (deflate без заголовка — ровно метод 8 ZIP).
 *
 * Что не поддерживается и отклоняется понятной ошибкой: шифрование, ZIP64
 * (файлы больше 4 ГБ — для таблицы с заявками их не бывает), архивы из нескольких
 * томов, методы сжатия кроме «без сжатия» (0) и deflate (8).
 */

/**
 * CRC-32 (IEEE 802.3), таблица на 256 значений.
 *
 * `zlib.crc32` появилась только в Node 22.2, а `engines` проекта допускает 20.19 —
 * своя таблица короче проверки версии.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** Путь внутри архива через «/». */
  name: string
  data: Uint8Array
}

/** Время в архиве постоянное (1 января 1980) — одинаковый вход даёт одинаковый файл. */
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1
/** Бит 11 — имена в UTF-8. */
const FLAG_UTF8 = 0x0800

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

/** Собирает ZIP. Каждый файл сжимается deflate, если это выгодно, иначе хранится как есть. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const deflated = deflateRawSync(entry.data)
    const useDeflate = deflated.length < entry.data.length
    const payload = useDeflate ? deflated : Buffer.from(entry.data)
    const method = useDeflate ? 8 : 0
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // Дополнительное поле, комментарий, диск, атрибуты — нули.
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + payload.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(SIG_END, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, end])
}

export interface ReadZipLimits {
  /** Больше файлов в архиве не принимаем. */
  maxEntries: number
  /** Суммарный объём после распаковки — защита от «ZIP-бомбы». */
  maxTotalBytes: number
}

const DEFAULT_LIMITS: ReadZipLimits = { maxEntries: 500, maxTotalBytes: 50 * 1024 * 1024 }

const broken = (message: string) =>
  validationError('Файл не похож на книгу Excel (.xlsx)', [{ field: 'file', message }])

function findEnd(buffer: Buffer): number {
  // Конец центрального каталога — последние 22 байта плюс комментарий до 64 КБ.
  const from = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_END) return i
  }
  return -1
}

/**
 * Читает архив: имя → содержимое. Размеры и смещения берутся из центрального
 * каталога — он надёжнее локальных заголовков (при потоковой записи в них нули).
 */
export function readZip(bytes: Uint8Array, limits: ReadZipLimits = DEFAULT_LIMITS): Map<string, Buffer> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.length < 22) throw broken('Файл слишком короткий для архива')

  const end = findEnd(buffer)
  if (end < 0) throw broken('Не найден каталог архива — файл повреждён или это не .xlsx')

  const count = buffer.readUInt16LE(end + 10)
  const directorySize = buffer.readUInt32LE(end + 12)
  const directoryOffset = buffer.readUInt32LE(end + 16)
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw broken('Архив в формате ZIP64 не поддерживается')
  }
  if (count > limits.maxEntries) throw broken(`В архиве больше ${limits.maxEntries} файлов`)
  if (directoryOffset + directorySize > end) throw broken('Каталог архива выходит за его пределы')

  const files = new Map<string, Buffer>()
  let total = 0
  let cursor = directoryOffset

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw broken('Каталог архива повреждён')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength

    if (flags & 0x1) throw broken('Файл защищён паролем — сохраните его без пароля')
    if (name.endsWith('/')) continue

    total += size
    if (total > limits.maxTotalBytes) {
      throw broken(`После распаковки файл больше ${Math.round(limits.maxTotalBytes / 1024 / 1024)} МБ`)
    }

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw broken(`Повреждён заголовок файла ${name}`)
    }
    const dataStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    if (dataStart + compressedSize > buffer.length) throw broken(`Файл ${name} обрезан`)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)

    let data: Buffer
    if (method === 0) {
      data = Buffer.from(raw)
    } else if (method === 8) {
      try {
        // maxOutputLength — чтобы заявленный размер нельзя было обмануть.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
      } catch {
        throw broken(`Не удалось распаковать ${name}`)
      }
    } else {
      throw broken(`Метод сжатия ${method} не поддерживается`)
    }

    if (data.length !== size || crc32(data) !== crc) throw broken(`Контрольная сумма ${name} не сошлась`)
    files.set(name, data)
  }

  return files
}

/** Начинается ли файл как ZIP (а значит, возможно, .xlsx). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}
