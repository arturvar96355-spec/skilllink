'use client'

import { useState } from 'react'
import type { DuplicatePairDto, UniversityDto, UniversityListItemDto } from '@/shared/contracts'
import { Button, Modal, RemoteSelect, universityFullOption, universityHref, useResource } from '@/ui'
import { MergeUniversitiesModal } from '../../data-quality/MergeUniversitiesModal'

/**
 * «Слить с дублем» в карточке вуза (решение 210, В6).
 *
 * Слияние было только в «Качество данных» → «Кандидаты в дубли» и только для пар,
 * которые нашла система: на демо-данных пар вузов нет, и проверяющий слияния не нашёл
 * вовсе. Здесь администратор сам выбирает второй вуз, дальше — то же окно
 * `MergeUniversitiesModal` с предпросмотром, выбором, какой вуз оставить, и отменой.
 * Права те же: кнопку видит только ADMIN (сервер проверяет сам, решение 134).
 */
export function MergeWithDuplicate({
  university,
  onMerged,
}: {
  university: { id: string; name: string; city: string | null }
  onMerged: () => void
}) {
  const [isPicking, setIsPicking] = useState(false)
  const [otherId, setOtherId] = useState('')
  const [pair, setPair] = useState<DuplicatePairDto | null>(null)
  // Имя второго вуза — для окна слияния; карточку оно всё равно читает само.
  const other = useResource<UniversityDto>(otherId !== '' && otherId !== university.id ? `/api/universities/${otherId}` : null)
  const isSelf = otherId === university.id

  function close() {
    setIsPicking(false)
    setOtherId('')
  }

  function next() {
    setPair({
      entity: 'university',
      a: { id: university.id, name: university.name, hint: university.city, href: universityHref(university.id) },
      b: { id: otherId, name: other.data?.name ?? 'Второй вуз', hint: other.data?.city ?? null, href: universityHref(otherId) },
      score: 0,
      method: 'normalized',
      reasons: ['Выбрано вручную'],
      dismissed: false,
    })
    setIsPicking(false)
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setIsPicking(true)}>
        Слить с дублем
      </Button>

      {isPicking && (
        <Modal
          isOpen
          onClose={close}
          title="Слить с дублем"
          description="Выберите вуз, который на самом деле тот же, что этот. На следующем шаге — сравнение полей, выбор, какой оставить, и отмена сразу после слияния. Пары, которые система нашла сама, — в «Качество данных» → «Кандидаты в дубли»."
          closeOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                Отмена
              </Button>
              <Button variant="primary" onClick={next} disabled={otherId === '' || isSelf || !other.data}>
                Дальше
              </Button>
            </>
          }
        >
          <RemoteSelect<UniversityListItemDto>
            label="Второй вуз"
            required
            endpoint="/api/universities"
            params={{ withRating: 'false', sort: 'name' }}
            toOption={universityFullOption}
            placeholder="Выберите вуз"
            value={otherId}
            onValueChange={setOtherId}
            error={isSelf ? 'Это тот же вуз — выберите другой' : null}
          />
        </Modal>
      )}

      {pair && (
        <MergeUniversitiesModal
          pair={pair}
          onClose={() => setPair(null)}
          onMerged={onMerged}
        />
      )}
    </>
  )
}
