import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  BULK_TARGET_STATUSES,
  MATERIALS_UPDATE_STAGE_NUMBER,
  assertVersionChanged,
  assertVersionEditable,
  assertVersionFormat,
  duplicateNameConflict,
  releaseTaskTitle,
  reopenComment,
} from './products.rules'
import {
  createProductSchema,
  productListQuerySchema,
  releaseProductVersionSchema,
  setProductSkillsSchema,
  updateProductSchema,
} from './products.schema'

function expectError(fn: () => void, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  throw new Error(`Ожидалась ошибка ${code}, но её не было`)
}

describe('групповая операция по продукту', () => {
  it('затрагивает этап обновления материалов', () => {
    expect(MATERIALS_UPDATE_STAGE_NUMBER).toBe(12)
  })

  it('не трогает закрытые и отменённые связки', () => {
    expect([...BULK_TARGET_STATUSES]).toEqual(['DRAFT', 'ACTIVE', 'PAUSED'])
    expect([...BULK_TARGET_STATUSES]).not.toContain('COMPLETED')
    expect([...BULK_TARGET_STATUSES]).not.toContain('CANCELLED')
  })

  it('повторный выпуск той же версии отклоняется', () => {
    expectError(() => assertVersionChanged('3.2', '3.2'), 'CONFLICT')
    expect(() => assertVersionChanged('3.2', '3.3')).not.toThrow()
  })

  it('продукт без версии можно выпустить впервые', () => {
    expect(() => assertVersionChanged(null, '1.0')).not.toThrow()
  })

  it('пустая версия отклоняется', () => {
    expectError(() => assertVersionFormat('   '), 'VALIDATION_ERROR')
    expect(() => assertVersionFormat('4.1')).not.toThrow()
  })

  it('задача называет продукт и версию', () => {
    const title = releaseTaskTitle('Облачная платформа РТК', '3.3')
    expect(title).toContain('Облачная платформа РТК')
    expect(title).toContain('3.3')
  })

  it('комментарий переоткрытия объясняет причину', () => {
    const comment = reopenComment('Облачная платформа РТК', '3.3')
    expect(comment).toContain('устарели')
    expect(comment).toContain('3.3')
  })
})

describe('валидация выпуска версии', () => {
  it('требует версию', () => {
    expect(releaseProductVersionSchema.safeParse({}).success).toBe(false)
    expect(releaseProductVersionSchema.safeParse({ version: '' }).success).toBe(false)
  })

  it('принимает версию с комментарием', () => {
    expect(
      releaseProductVersionSchema.safeParse({ version: '4.0', comment: 'Плановое обновление' })
        .success,
    ).toBe(true)
  })
})

describe('параметры списка продуктов', () => {
  it('приводит одиночный статус к массиву', () => {
    expect(productListQuerySchema.parse({ status: 'ACTIVE' }).status).toEqual(['ACTIVE'])
  })

  it('отклоняет неизвестный статус', () => {
    expect(productListQuerySchema.safeParse({ status: 'RETIRED' }).success).toBe(false)
  })
})

describe('заведение продукта', () => {
  const valid = { name: 'Платформа видеоконференций', category: 'Коммуникации' }

  it('хватает названия и категории, статус по умолчанию — действующий', () => {
    const parsed = createProductSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.status).toBe('ACTIVE')
  })

  it('без названия или категории отклоняется', () => {
    expect(createProductSchema.safeParse({ category: 'Облако' }).success).toBe(false)
    expect(createProductSchema.safeParse({ name: 'Продукт' }).success).toBe(false)
    expect(createProductSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
  })

  it('обрезает пробелы по краям названия', () => {
    expect(createProductSchema.parse({ ...valid, name: '  Платформа  ' }).name).toBe('Платформа')
  })

  it('отклоняет неизвестный статус', () => {
    expect(createProductSchema.safeParse({ ...valid, status: 'RETIRED' }).success).toBe(false)
  })

  it('пустая версия — не версия', () => {
    expect(createProductSchema.safeParse({ ...valid, version: '  ' }).success).toBe(false)
    expect(createProductSchema.safeParse({ ...valid, version: null }).success).toBe(true)
  })
})

describe('ссылка на документацию', () => {
  const withUrl = (documentationUrl: string) =>
    createProductSchema.safeParse({ name: 'Продукт', category: 'Облако', documentationUrl })

  it('принимает http и https', () => {
    expect(withUrl('https://docs.example.invalid/product').success).toBe(true)
    expect(withUrl('http://docs.example.invalid').success).toBe(true)
  })

  it('отклоняет адреса, которые выполнились бы по щелчку, и прочие протоколы', () => {
    expect(withUrl('javascript:alert(1)').success).toBe(false)
    expect(withUrl('data:text/html,<b>1</b>').success).toBe(false)
    expect(withUrl('ftp://files.example.invalid').success).toBe(false)
  })

  it('отклоняет не адрес', () => {
    expect(withUrl('документация у Пети').success).toBe(false)
  })

  it('объясняет отказ по-русски', () => {
    const parsed = withUrl('javascript:alert(1)')
    expect(parsed.success).toBe(false)
    expect(!parsed.success && parsed.error.issues[0]?.message).toContain('http')
  })

  it('ссылку можно снять', () => {
    expect(updateProductSchema.safeParse({ documentationUrl: null }).success).toBe(true)
  })
})

describe('изменение продукта', () => {
  it('не принимает пустое тело', () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false)
  })

  it('не подставляет статус по умолчанию', () => {
    const parsed = updateProductSchema.safeParse({ description: 'Новое описание' })
    expect(parsed.success && 'status' in parsed.data).toBe(false)
  })
})

describe('дубль названия', () => {
  it('— конфликт с понятным текстом и полем для формы', () => {
    const error = duplicateNameConflict('Облачная платформа РТК')
    expect(error.code).toBe('CONFLICT')
    expect(error.status).toBe(409)
    expect(error.message).toContain('Облачная платформа РТК')
    expect(error.message).toContain('уже есть')
    expect(error.details).toEqual([expect.objectContaining({ field: 'name' })])
  })
})

describe('версия при правке карточки', () => {
  it('без открытых связок меняется свободно', () => {
    expect(() => assertVersionEditable('1.0', '1.1', 0)).not.toThrow()
    expect(() => assertVersionEditable(null, '1.0', 0)).not.toThrow()
  })

  it('с открытыми связками — только выпуском версии', () => {
    expectError(() => assertVersionEditable('1.0', '1.1', 2), 'CONFLICT')
    expectError(() => assertVersionEditable('1.0', null, 1), 'CONFLICT')
  })

  it('та же версия или её отсутствие в запросе — не изменение', () => {
    expect(() => assertVersionEditable('1.0', '1.0', 5)).not.toThrow()
    expect(() => assertVersionEditable('1.0', undefined, 5)).not.toThrow()
  })

  it('отказ называет число связок и путь через выпуск версии', () => {
    try {
      assertVersionEditable('1.0', '2.0', 3)
    } catch (error) {
      expect((error as AppError).message).toContain('3 открытые связки')
      expect((error as AppError).message).toContain('выпуском версии')
      return
    }
    throw new Error('Ожидался отказ')
  })
})

describe('набор навыков продукта', () => {
  it('подставляет значимость по умолчанию', () => {
    const parsed = setProductSkillsSchema.parse({ skills: [{ skillId: 'skill-1' }] })
    expect(parsed.skills[0]).toEqual({ skillId: 'skill-1', relevance: 'RELATED' })
  })

  it('принимает пустой список: навыки можно снять целиком', () => {
    expect(setProductSkillsSchema.safeParse({ skills: [] }).success).toBe(true)
  })

  it('отклоняет неизвестную значимость', () => {
    expect(
      setProductSkillsSchema.safeParse({ skills: [{ skillId: 's', relevance: 'MUST' }] }).success,
    ).toBe(false)
  })
})
