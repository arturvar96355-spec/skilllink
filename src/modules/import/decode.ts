import { validationError } from '@/shared/http/errors'

/**
 * Чтение загруженного файла в кодировке, в которой его сохранил человек.
 *
 * Excel в Windows по умолчанию сохраняет CSV в Windows-1251: «CSV UTF-8» —
 * отдельный пункт меню, который легко не заметить. Такой файл, прочитанный
 * как UTF-8, превращается в мусор уже в строке заголовков, и система отвечала
 * «Не найдены: Название, Город, Регион» — человек открывал файл, видел эти
 * колонки на месте и не понимал, чего от него хотят.
 *
 * Определение по порядку, без угадывания: корректный UTF-8 читается как UTF-8,
 * и только то, что им не является, читается как Windows-1251. Ошибиться здесь
 * почти невозможно: байты кириллицы в Windows-1251 не складываются
 * в правильные последовательности UTF-8.
 */
export type CsvEncoding = 'utf-8' | 'windows-1251'

export interface DecodedCsv {
  text: string
  encoding: CsvEncoding
}

/** UTF-16 Excel сохраняет под видом «Текст Юникод», и это не CSV. */
function rejectUtf16(bytes: Uint8Array): void {
  const utf16le = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  const utf16be = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  if (!utf16le && !utf16be) return
  throw validationError('Файл сохранён в кодировке UTF-16', [
    {
      field: 'csv',
      message:
        'Это формат «Текст Юникод», а не CSV. В Excel сохраните как «CSV UTF-8 (разделитель — запятая)».',
    },
  ])
}

/**
 * Нулевых байтов в текстовом CSV не бывает — они есть в .xlsx, в UTF-16 без метки
 * и в любом другом двоичном файле. Такой файл читался как Windows-1251 и дальше
 * давал то «не найдены колонки» при колонках на месте, то внутреннюю ошибку
 * на записи: символ с кодом 0 база не принимает (shared/db/storable.ts).
 */
function rejectBinary(text: string): void {
  const position = text.indexOf('\u0000')
  if (position === -1) return
  const line = text.slice(0, position).split('\n').length
  throw validationError('Файл не похож на текстовый CSV', [
    {
      field: 'csv',
      message:
        `В строке ${line} нулевой байт — так выглядят файлы Excel (.xlsx) и другие двоичные файлы. ` +
        'В Excel сохраните как «CSV UTF-8 (разделитель — запятая)».',
    },
  ])
}

function decode(bytes: Uint8Array): DecodedCsv {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // Не UTF-8 — значит, файл из Excel в Windows. Windows-1251 покрывает
    // кириллицу целиком, и декодирование в ней не отказывает никогда,
    // поэтому запасного варианта дальше нет и не нужно.
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' }
  }
}

export function decodeCsv(bytes: Uint8Array): DecodedCsv {
  rejectUtf16(bytes)
  const decoded = decode(bytes)
  rejectBinary(decoded.text)
  return decoded
}
