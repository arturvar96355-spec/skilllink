'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import type { ImportResultDto, ImportRowResultDto, VendorImportResultDto } from '@/shared/contracts'
import {
  Badge,
  Button,
  Card,
  Icon,
  PageHeader,
  Section,
  Select,
  Tabs,
  apiUploadRaw,
  buildQuery,
  formatDateTime,
  useCurrentUser,
  useMutation,
  useToast,
  type TabItem,
} from '@/ui'
import { encodingLabel, hasImportChanges, importSummaryText, OUTCOME_LABELS, OUTCOME_TONES } from './import-report'
import styles from './import.module.css'

/**
 * Импорт данных (задача «Данные без экрана», пункт 5; ТЗ — актуализация
 * каталогов через xls/xlsx). `POST /api/import` и `POST /api/import/vendors`
 * умели читать файл с самого начала (решение 132), но обновить реестр можно
 * было только через `/api-docs` или curl — интерфейса не было вовсе.
 *
 * По умолчанию — предпросмотр (`mode=preview`): что создастся, что обновится
 * и построчные ошибки, без единой записи в базу. «Применить» шлёт тот же файл
 * повторно с `mode=apply` — так же, как задуман сам API.
 */

type Dataset = 'universities' | 'programs'

/**
 * Требуемые и необязательные колонки файла — дубль `UNIVERSITY_COLUMNS`
 * и `PROGRAM_COLUMNS` из `src/modules/import/import.schema.ts`: серверный
 * модуль на фронт не импортируется (правило «поток route → service → repo»,
 * CLAUDE.md), а колонки нужны здесь только текстом подсказки — так же, как
 * `ALLOWED_TRANSITIONS` продублирован в `documents/page.tsx`.
 */
const DATASET_COLUMNS: Record<Dataset, { required: string[]; optional: string[] }> = {
  universities: {
    required: ['Название', 'Город', 'Регион'],
    optional: ['Краткое название', 'Направлений', 'Студентов', 'Сайт'],
  },
  programs: {
    required: ['Вуз', 'Программа', 'Уровень'],
    optional: ['Код', 'Направление', 'Длительность, мес.', 'Заявки', 'Обучающихся', 'Групп'],
  },
}

const DATASET_LABELS: Record<Dataset, string> = {
  universities: 'Вузы',
  programs: 'Образовательные программы',
}

export default function ImportPage() {
  const user = useCurrentUser()
  const [tab, setTab] = useState<'catalogs' | 'vendors'>('catalogs')

  const tabs: TabItem[] = [
    { key: 'catalogs', label: 'Вузы и программы' },
    { key: 'vendors', label: 'Вендоры' },
  ]

  return (
    <>
      <PageHeader
        title="Импорт данных"
        description="Загрузка файла из Excel: сначала предпросмотр — что изменится и построчные ошибки, запись в базу — только по «Применить»."
      />

      {!user.permissions.canWrite && (
        <Card muted>
          <p className={styles.note}>
            Загрузка недоступна вашей роли: показывается только тем, кто может изменять реестры.
          </p>
        </Card>
      )}

      {user.permissions.canWrite && (
        <>
          <Tabs items={tabs} active={tab} onChange={(key) => setTab(key as typeof tab)} />
          {tab === 'catalogs' && <CatalogImportSection />}
          {tab === 'vendors' && <VendorImportSection />}
        </>
      )}
    </>
  )
}

/** Строка предпросмотра — общая часть для обоих отчётов о загрузке. */
function ReportLine({ line, label, outcome, detail }: ImportRowResultDto) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLine}>строка {line}</span>
      <span className={styles.rowLabel}>{label}</span>
      <Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>
      <span className={styles.rowDetail}>{detail}</span>
    </div>
  )
}

function CatalogImportSection() {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dataset, setDataset] = useState<Dataset>('universities')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResultDto | null>(null)

  const run = useMutation(async (mode: 'preview' | 'apply') => {
    if (!file) throw new Error('Файл не выбран')
    const query = buildQuery({ dataset, mode })
    const response = await apiUploadRaw<ImportResultDto>(`/api/import${query}`, file)
    return response.data
  })

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!picked) return
    setFile(picked)
    setResult(null)
    run.reset()
  }

  async function onPreview() {
    const outcome = await run.run('preview')
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    setResult(outcome.data)
  }

  async function onApply() {
    const outcome = await run.run('apply')
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    setResult(outcome.data)
    toast.success(`Загружено: ${importSummaryText(outcome.data)}`)
  }

  const columns = DATASET_COLUMNS[dataset]

  return (
    <Section
      title="Реестры вузов и программ"
      description="Файл CSV с теми же заголовками, что и у выгрузки реестра: цикл «выгрузил → поправил в Excel → загрузил обратно» работает без переименований колонок."
    >
      <Card>
        <div className={styles.form}>
          <Select
            label="Что загружаем"
            value={dataset}
            onValueChange={(value) => {
              setDataset(value as Dataset)
              setFile(null)
              setResult(null)
              run.reset()
            }}
            options={[
              { value: 'universities', label: DATASET_LABELS.universities },
              { value: 'programs', label: DATASET_LABELS.programs },
            ]}
          />

          <p className={styles.hint}>
            Обязательные колонки: {columns.required.join(', ')}. Необязательные: {columns.optional.join(', ')}.
          </p>

          <div className={styles.uploadRow}>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className={styles.hiddenInput}
              onChange={onPick}
              tabIndex={-1}
              aria-hidden="true"
            />
            <Button variant="secondary" icon="attach" onClick={() => inputRef.current?.click()}>
              Выбрать файл CSV
            </Button>
            <span className={styles.fileName}>{file ? file.name : 'Файл не выбран'}</span>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={onPreview} isLoading={run.isPending} disabled={!file}>
              Показать, что изменится
            </Button>
            <Button
              variant="primary"
              onClick={onApply}
              isLoading={run.isPending}
              disabled={!file || !result || !hasImportChanges(result)}
            >
              Применить
            </Button>
          </div>

          {run.error && (
            <p className={styles.refusal} role="alert">
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>Файл не принят</span>
                {run.error.message}
              </span>
            </p>
          )}
        </div>
      </Card>

      {result && (
        <Card>
          <div className={styles.report}>
            <p className={styles.summary}>
              {result.mode === 'apply' ? 'Загружено. ' : 'Предпросмотр — база не изменена. '}
              {importSummaryText(result)}
            </p>
            <p className={styles.hint}>
              Кодировка файла: {encodingLabel(result.encoding)} · обработано {formatDateTime(result.processedAt)}
            </p>
            {result.rows.length === 0 ? (
              <p className={styles.note}>Строк для показа нет.</p>
            ) : (
              <div className={styles.rows}>
                {result.rows.map((row) => (
                  <ReportLine key={row.line} {...row} />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </Section>
  )
}

function VendorImportSection() {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<VendorImportResultDto | null>(null)

  const run = useMutation(async (mode: 'preview' | 'apply') => {
    if (!file) throw new Error('Файл не выбран')
    const query = buildQuery({ mode })
    const response = await apiUploadRaw<VendorImportResultDto>(`/api/import/vendors${query}`, file)
    return response.data
  })

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!picked) return
    setFile(picked)
    setResult(null)
    run.reset()
  }

  async function onPreview() {
    const outcome = await run.run('preview')
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    setResult(outcome.data)
  }

  async function onApply() {
    const outcome = await run.run('apply')
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    setResult(outcome.data)
    toast.success('Вендоры загружены')
  }

  const hasChanges =
    result !== null &&
    (result.toCreate.vendors.length > 0 ||
      result.toCreate.products.length > 0 ||
      result.toCreate.contacts.length > 0 ||
      result.toUpdate.products.length > 0 ||
      result.toUpdate.contacts.length > 0)

  return (
    <Section
      title="Вендоры, продукты и контакты"
      description="Книга Excel (.xlsx) или CSV — колонки как в выгрузке реестра вендоров. Ячейка «Продукт» может перечислять несколько продуктов через запятую."
    >
      <Card>
        <div className={styles.form}>
          <div className={styles.uploadRow}>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className={styles.hiddenInput}
              onChange={onPick}
              tabIndex={-1}
              aria-hidden="true"
            />
            <Button variant="secondary" icon="attach" onClick={() => inputRef.current?.click()}>
              Выбрать файл
            </Button>
            <span className={styles.fileName}>{file ? file.name : 'Файл не выбран'}</span>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={onPreview} isLoading={run.isPending} disabled={!file}>
              Показать, что изменится
            </Button>
            <Button variant="primary" onClick={onApply} isLoading={run.isPending} disabled={!file || !hasChanges}>
              Применить
            </Button>
          </div>

          {run.error && (
            <p className={styles.refusal} role="alert">
              <Icon name="alert" size={20} />
              <span>
                <span className={styles.refusalTitle}>Файл не принят</span>
                {run.error.message}
              </span>
            </p>
          )}
        </div>
      </Card>

      {result && (
        <Card>
          <div className={styles.report}>
            <p className={styles.summary}>
              {result.mode === 'apply' ? 'Загружено. ' : 'Предпросмотр — база не изменена. '}
              Всего строк: {result.totalRows}. Формат: {result.format === 'xlsx' ? 'Excel' : 'CSV'}
              {result.sheet ? `, лист «${result.sheet}»` : ''}.
            </p>

            <div className={styles.block}>
              <span className={styles.blockLabel}>К созданию</span>
              <span className={styles.blockText}>
                вендоров {result.toCreate.vendors.length}, продуктов {result.toCreate.products.length}, контактов{' '}
                {result.toCreate.contacts.length}
              </span>
            </div>

            {(result.toUpdate.products.length > 0 || result.toUpdate.contacts.length > 0) && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>К обновлению</span>
                {result.toUpdate.products.map((item) => (
                  <span key={item.name} className={styles.blockText}>
                    {item.name} — {item.change}
                  </span>
                ))}
                {result.toUpdate.contacts.map((item) => (
                  <span key={`${item.vendor}-${item.fullName}`} className={styles.blockText}>
                    {item.fullName} ({item.vendor}) — {item.fields.join(', ')}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.block}>
              <span className={styles.blockLabel}>Без изменений</span>
              <span className={styles.blockText}>
                продуктов {result.unchanged.products}, контактов {result.unchanged.contacts}
              </span>
            </div>

            {result.errors.length > 0 && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Ошибки</span>
                {result.errors.map((issue, index) => (
                  <span key={index} className={styles.blockText}>
                    строка {issue.row}, «{issue.column}»: {issue.message}
                  </span>
                ))}
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className={styles.block}>
                <span className={styles.blockLabel}>Замечания</span>
                {result.warnings.map((issue, index) => (
                  <span key={index} className={styles.blockText}>
                    строка {issue.row}, «{issue.column}»: {issue.message}
                  </span>
                ))}
              </div>
            )}

            <p className={styles.hint}>
              Телефонов приведено к формату: {result.quality.phonesNormalized}, почт в нижний регистр:{' '}
              {result.quality.emailsLowercased}, продуктов найдено по названию: {result.quality.productsMatched}
              {result.quality.multiProductCells > 0 &&
                `, ячеек с несколькими продуктами: ${result.quality.multiProductCells}`}
              . Обработано {formatDateTime(result.processedAt)}{result.encoding ? `, кодировка ${encodingLabel(result.encoding)}` : ''}.
            </p>
          </div>
        </Card>
      )}
    </Section>
  )
}

