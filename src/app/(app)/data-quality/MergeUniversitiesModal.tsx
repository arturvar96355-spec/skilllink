'use client'

import { useState } from 'react'
import type { DuplicatePairDto, MergeableUniversityField, UniversityDto, UniversityMergeDto } from '@/shared/contracts'
import {
  Button,
  CardsSkeleton,
  ErrorState,
  Modal,
  NO_DATA,
  apiPost,
  formatDateTime,
  formatNumber,
  useMutation,
  useResource,
  useToast,
} from '@/ui'
import styles from './quality.module.css'

/** Поля вуза, которые показываются в предпросмотре слияния — раздел «Слияние вузов» контракта. */
const COMPARE_FIELDS: { key: MergeableUniversityField; label: string }[] = [
  { key: 'name', label: 'Название' },
  { key: 'shortName', label: 'Короткое название' },
  { key: 'city', label: 'Город' },
  { key: 'region', label: 'Регион' },
  { key: 'address', label: 'Адрес' },
  { key: 'website', label: 'Сайт' },
  { key: 'description', label: 'Описание' },
  { key: 'directionCount', label: 'Направлений' },
  { key: 'studentCount', label: 'Студентов' },
]

const MOVED_LABELS: Record<keyof UniversityMergeDto['moved'], string> = {
  programs: 'программ',
  contacts: 'контактов',
  cooperations: 'связок',
  meetings: 'встреч',
  documents: 'документов',
  applications: 'заявок',
  users: 'учётных записей представителей',
}

function fieldValue(value: string | number | null): string {
  if (value === null || value === '') return NO_DATA
  return String(value)
}

/** Правило по умолчанию для предпросмотра — `non_null` (решение 134): значение цели, а если его нет — источника. */
function previewResult(target: string | number | null, source: string | number | null): string | number | null {
  if (target !== null && target !== '') return target
  return source
}

interface Props {
  pair: DuplicatePairDto
  onClose: () => void
  onMerged: () => void
}

/**
 * Слияние вузов-дублей (решение 182, п. 2).
 *
 * Сервер не даёт «пробный» режим слияния — предпросмотр строится на фронте из
 * карточек обеих записей по тому же правилу `non_null`, что применяет сервер
 * по умолчанию. Точные числа переехавших записей контракт отдаёт только в ответе
 * самого слияния — до него в тексте есть только честный список, что переедет,
 * без выдуманных чисел.
 */
export function MergeUniversitiesModal({ pair, onClose, onMerged }: Props) {
  // По умолчанию сохраняем `a` (пара упорядочена по id, а не по «важности») —
  // переключатель ниже меняет местами без повторного открытия окна.
  const [keepId, setKeepId] = useState(pair.a.id)
  const [result, setResult] = useState<UniversityMergeDto | null>(null)
  const toast = useToast()

  const target = keepId === pair.a.id ? pair.a : pair.b
  const source = keepId === pair.a.id ? pair.b : pair.a

  const targetRes = useResource<UniversityDto>(`/api/universities/${target.id}`)
  const sourceRes = useResource<UniversityDto>(`/api/universities/${source.id}`)

  const merge = useMutation(async () =>
    (await apiPost<UniversityMergeDto>('/api/universities/merge', { sourceId: source.id, targetId: target.id })).data,
  )
  const undo = useMutation(
    async (mergeId: string) => (await apiPost<{ merge: UniversityMergeDto }>(`/api/universities/merge/${mergeId}/undo`)).data,
  )

  async function onConfirm() {
    const outcome = await merge.run(undefined)
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    setResult(outcome.data)
    toast.success(`«${source.name}» слит с «${target.name}»`)
    onMerged()
  }

  async function onUndo() {
    if (!result) return
    const outcome = await undo.run(result.id)
    if (!outcome.ok) {
      toast.error(outcome.error.message)
      return
    }
    toast.success('Слияние отменено')
    onMerged()
    onClose()
  }

  if (result) {
    const movedEntries = (Object.keys(MOVED_LABELS) as Array<keyof UniversityMergeDto['moved']>).filter(
      (key) => result.moved[key] > 0,
    )
    return (
      <Modal isOpen title="Вузы слиты" onClose={onClose} footer={<Button onClick={onClose}>Готово</Button>}>
        <div className={styles.mergeResult}>
          <p>
            «{source.name}» перешёл в архив со ссылкой на «{target.name}». Переехало:{' '}
            {movedEntries.length === 0
              ? 'переносить было нечего'
              : movedEntries.map((key) => `${formatNumber(result.moved[key])} ${MOVED_LABELS[key]}`).join(', ')}
            .
          </p>
          <p className={styles.mergeUndoHint}>
            Отменить можно до {formatDateTime(result.undoUntil)} — но только сейчас, до закрытия этого окна:
            реестр не хранит ссылку на выполненные слияния, кнопка отмены есть только в момент слияния.
          </p>
          <Button variant="secondary" onClick={() => void onUndo()} isLoading={undo.isPending} disabled={undo.isPending}>
            Отменить слияние
          </Button>
        </div>
      </Modal>
    )
  }

  const isLoading = targetRes.isLoading || sourceRes.isLoading
  const error = targetRes.error ?? sourceRes.error

  return (
    <Modal
      isOpen
      title="Слить дубли вузов"
      help={{ topic: 'data-quality', section: 'merge' }}
      description="Один вуз останется, второй уйдёт в архив со ссылкой на него — все его программы, связки, контакты, встречи, документы, заявки и учётные записи представителей переедут к оставшемуся."
      onClose={onClose}
      wide
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={merge.isPending}>
            Отмена
          </Button>
          <Button onClick={() => void onConfirm()} isLoading={merge.isPending} disabled={merge.isPending || isLoading || !!error}>
            Слить
          </Button>
        </>
      }
    >
      {isLoading ? (
        <CardsSkeleton count={1} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => { targetRes.reload(); sourceRes.reload() }} />
      ) : (
        <>
          <div className={styles.mergeDirection}>
            <span>Оставляем:</span>
            <Button
              size="sm"
              variant={keepId === pair.a.id ? 'primary' : 'secondary'}
              onClick={() => setKeepId(pair.a.id)}
            >
              {pair.a.name}
            </Button>
            <Button
              size="sm"
              variant={keepId === pair.b.id ? 'primary' : 'secondary'}
              onClick={() => setKeepId(pair.b.id)}
            >
              {pair.b.name}
            </Button>
          </div>
          <table className={styles.mergeCompare}>
            <thead>
              <tr>
                <th>Поле</th>
                <th>Останется ({target.name})</th>
                <th>Уйдёт в архив ({source.name})</th>
                <th>После слияния</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_FIELDS.map(({ key, label }) => {
                const targetValue = (targetRes.data?.[key] ?? null) as string | number | null
                const sourceValue = (sourceRes.data?.[key] ?? null) as string | number | null
                const outcome = previewResult(targetValue, sourceValue)
                const changed = outcome !== targetValue
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td data-label={`Останется (${target.name})`}>{fieldValue(targetValue)}</td>
                    <td data-label={`Уйдёт в архив (${source.name})`}>{fieldValue(sourceValue)}</td>
                    <td data-label="После слияния" className={changed ? styles.mergeChanged : undefined}>
                      {fieldValue(outcome)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}
