import { describe, expect, it } from 'vitest'
import {
  createProgramSchema,
  programListQuerySchema,
  setProgramSkillsSchema,
  updateProgramSchema,
} from './programs.schema'
import { toMetric } from './programs.rules'

describe('валидация программы', () => {
  const valid = {
    universityId: 'uni-1',
    name: 'Программная инженерия',
    level: 'BACHELOR',
  }

  it('принимает программу без показателей набора', () => {
    const parsed = createProgramSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.status).toBe('ACTIVE')
  })

  it('разрешает явный null в показателе — это «Нет данных»', () => {
    const parsed = createProgramSchema.safeParse({ ...valid, studentCount: null })
    expect(parsed.success).toBe(true)
  })

  it('отклоняет отрицательные показатели', () => {
    expect(createProgramSchema.safeParse({ ...valid, groupCount: -1 }).success).toBe(false)
  })

  it('отклоняет неизвестный уровень образования', () => {
    expect(createProgramSchema.safeParse({ ...valid, level: 'PHD' }).success).toBe(false)
  })

  it('не принимает пустое тело изменения', () => {
    expect(updateProgramSchema.safeParse({}).success).toBe(false)
  })

  it('не подставляет статус по умолчанию при изменении', () => {
    const parsed = updateProgramSchema.safeParse({ name: 'Новое название' })
    expect(parsed.success && 'status' in parsed.data).toBe(false)
  })
})

describe('набор навыков программы', () => {
  it('подставляет значения по умолчанию', () => {
    const parsed = setProgramSkillsSchema.parse({ skills: [{ skillId: 'skill-1' }] })
    expect(parsed.skills[0]).toMatchObject({
      level: 'BASIC',
      importance: 'MEDIUM',
      source: 'CURRICULUM',
    })
  })

  it('принимает пустой список: навыки можно снять целиком', () => {
    expect(setProgramSkillsSchema.safeParse({ skills: [] }).success).toBe(true)
  })
})

describe('параметры списка программ', () => {
  it('приводит одиночный уровень к массиву', () => {
    expect(programListQuerySchema.parse({ level: 'MASTER' }).level).toEqual(['MASTER'])
  })

  it('отклоняет неизвестное значение фильтра', () => {
    expect(programListQuerySchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false)
  })
})

describe('происхождение показателя', () => {
  it('на отсутствующем значении возвращает null и пометку «Нет данных»', () => {
    const result = toMetric(null, 'заявки', 'Заявки на обучение', null, null, false)
    expect(result.value).toBeNull()
    expect(result.basis).toBe('none')
    expect(result.explanation).toContain('Нет данных')
  })

  it('демонстрационные данные помечает как оценочные', () => {
    const result = toMetric(120, 'заявки', 'Заявки на обучение', 'MOCK', new Date(), true)
    expect(result.basis).toBe('estimate')
    expect(result.isMock).toBe(true)
  })

  it('данные интеграции помечает как фактические', () => {
    const result = toMetric(120, 'заявки', 'Заявки на обучение', 'INTEGRATION', new Date(), false)
    expect(result.basis).toBe('actual')
    expect(result.isMock).toBe(false)
  })

  it('ноль остаётся нулём и не превращается в «Нет данных»', () => {
    const result = toMetric(0, 'групп', 'Количество параллельных групп', 'MANUAL', new Date(), false)
    expect(result.value).toBe(0)
    expect(result.basis).toBe('actual')
  })
})
