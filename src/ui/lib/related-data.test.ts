import { describe, expect, it } from 'vitest'
import { describeRelatedData } from './related-data'

describe('describeRelatedData', () => {
  it('просрочка этапа: подписи по-русски, дата по Москве, статус словом', () => {
    expect(
      describeRelatedData({
        stageNumber: 6,
        daysOverdue: 57,
        deadline: '2026-07-28T21:30:00.000Z',
        status: 'IN_PROGRESS',
      }),
    ).toEqual([
      { label: 'Этап', value: '6' },
      { label: 'Статус этапа', value: 'В работе' },
      // 21:30 UTC — это уже 29-е по Москве.
      { label: 'Нормативный срок', value: '29.07.2026' },
      { label: 'Просрочка', value: '57 дней' },
    ])
  })

  it('дефицит навыка: идентификаторы скрыты, остаток программ посчитан', () => {
    const facts = describeRelatedData({
      skillId: 'ck1',
      demandNormalized: 0.774,
      products: [{ id: 'p1', name: 'Облако РТК', relevance: 'CORE' }],
      programCount: 12,
      programs: [{ id: 'g1', name: 'Прикладная информатика', universityName: 'СПбГУТ' }],
    })
    expect(facts).toEqual([
      { label: 'Спрос на навык', value: '77 из 100' },
      { label: 'Продукты с этим навыком', value: 'Облако РТК' },
      { label: 'Программ без навыка', value: '12' },
      { label: 'Программы', value: 'Прикладная информатика (СПбГУТ) и ещё 11' },
    ])
  })

  it('пропуски показателей программы — теми же словами, что в рейтинге', () => {
    expect(describeRelatedData({ programId: 'x', missing: ['studentCount', 'groupCount'] })).toEqual([
      { label: 'Не заполнено', value: 'количество обучающихся, количество параллельных групп' },
    ])
  })

  it('незнакомое поле и значение неожиданного вида не пропадают', () => {
    expect(describeRelatedData({ newField: 3, daysOverdue: 'много' })).toEqual([
      { label: 'Просрочка', value: 'много' },
      { label: 'newField', value: '3' },
    ])
  })

  it('порядок строк не зависит от порядка ключей в базе', () => {
    // Так их возвращает jsonb: ключи отсортированы по длине.
    const labels = describeRelatedData({
      status: 'IN_PROGRESS',
      deadline: '2026-07-28T10:00:00.000Z',
      daysOverdue: 57,
      stageNumber: 6,
    }).map((fact) => fact.label)
    expect(labels).toEqual(['Этап', 'Статус этапа', 'Нормативный срок', 'Просрочка'])
  })

  it('нет данных — пустой список', () => {
    expect(describeRelatedData(null)).toEqual([])
  })
})
