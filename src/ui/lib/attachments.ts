/**
 * Форматы и предел размера файлов к документам и этапам — ровно из ТЗ
 * (функц. требования п.3, решение 145: «Возможность прикладывания файлов
 * в статусы в форматах png, jpeg, pdf, zip, gzip, rar, doc, docx, xls, xlsx»).
 *
 * Список задублирован здесь намеренно, а не импортирован из
 * `src/shared/config/attachments.config.ts`: тот файл использует `node:path`
 * (нужен только на сервере, чтобы вычислить каталог хранения) и не должен
 * попадать в клиентский бандл. Согласованность двух списков проверяет
 * `attachments.test.ts` рядом.
 */
export const ATTACHMENT_EXTENSIONS = [
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

/** Строка для атрибута `accept` поля выбора файла. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',')

/** Мегабайт — только для подсказки в интерфейсе; сам предел проверяет и отклоняет сервер. */
export const MAX_ATTACHMENT_MB = 20
