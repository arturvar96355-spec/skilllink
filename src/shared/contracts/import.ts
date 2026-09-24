/** Что произошло или произойдёт с одной строкой файла. */
export interface ImportRowResultDto {
  /** Номер строки в файле, считая заголовок первой: так человек найдёт её в Excel. */
  line: number
  /** Чем строка опознана: название вуза или «вуз — программа». */
  label: string
  /**
   * `unchanged` — запись найдена, и файл ничего в ней не меняет: повторная
   * загрузка только что выгруженного файла — не правка реестра.
   */
  outcome: 'create' | 'update' | 'unchanged' | 'skip' | 'error'
  /** Что именно изменится или почему строка не принята. */
  detail: string
}

export interface ImportResultDto {
  dataset: string
  /**
   * В какой кодировке прочитан файл. Excel в Windows сохраняет CSV
   * в `windows-1251`, и это нормальный случай, а не ошибка: поле нужно,
   * чтобы человек видел, как его файл поняли.
   */
  encoding: 'utf-8' | 'windows-1251'
  /** `preview` ничего не меняет, `apply` записывает. */
  mode: 'preview' | 'apply'
  totalRows: number
  created: number
  updated: number
  skipped: number
  /** Найдены, но не меняются. */
  unchanged: number
  errors: number
  rows: ImportRowResultDto[]
  processedAt: string
}
