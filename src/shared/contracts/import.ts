/** Что произошло или произойдёт с одной строкой файла. */
export interface ImportRowResultDto {
  /** Номер строки в файле, считая заголовок первой: так человек найдёт её в Excel. */
  line: number
  /** Чем строка опознана: название вуза или «вуз — программа». */
  label: string
  outcome: 'create' | 'update' | 'skip' | 'error'
  /** Что именно изменится или почему строка не принята. */
  detail: string
}

export interface ImportResultDto {
  dataset: string
  /** `preview` ничего не меняет, `apply` записывает. */
  mode: 'preview' | 'apply'
  totalRows: number
  created: number
  updated: number
  skipped: number
  errors: number
  rows: ImportRowResultDto[]
  processedAt: string
}
