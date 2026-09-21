import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  ALLOWED_DOCUMENT_TRANSITIONS,
  assertDocumentEditable,
  assertDocumentTransition,
  assertHasLink,
  nextVersion,
} from './documents.rules'
import {
  createDocumentSchema,
  documentListQuerySchema,
  updateDocumentSchema,
} from './documents.schema'

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

const doc = (
  status: Parameters<typeof assertDocumentEditable>[0],
  fileReference: string | null = 'https://example.invalid/doc.pdf',
) => ({ status, fileReference })

describe('жизненный цикл документа', () => {
  it('подписанный документ можно только заархивировать', () => {
    expect(ALLOWED_DOCUMENT_TRANSITIONS.SIGNED).toEqual(['ARCHIVED'])
  })

  it('архив — конечное состояние', () => {
    expect(ALLOWED_DOCUMENT_TRANSITIONS.ARCHIVED).toEqual([])
  })

  it('черновик уходит на согласование', () => {
    expect(() =>
      assertDocumentTransition(doc('DRAFT'), { toStatus: 'REVIEW' }),
    ).not.toThrow()
  })

  it('нельзя подписать документ, минуя согласование', () => {
    expectError(
      () => assertDocumentTransition(doc('DRAFT'), { toStatus: 'SIGNED' }),
      'INVALID_TRANSITION',
    )
  })

  it('нельзя вернуть подписанный документ в работу', () => {
    expectError(
      () => assertDocumentTransition(doc('SIGNED'), { toStatus: 'DRAFT', comment: 'Ошибка' }),
      'INVALID_TRANSITION',
    )
  })

  it('нельзя перевести документ в тот же статус', () => {
    expectError(
      () => assertDocumentTransition(doc('DRAFT'), { toStatus: 'DRAFT' }),
      'INVALID_TRANSITION',
    )
  })

  it('на согласование нельзя отправить документ без ссылки на файл', () => {
    expectError(
      () => assertDocumentTransition(doc('DRAFT', null), { toStatus: 'REVIEW' }),
      'VALIDATION_ERROR',
    )
  })

  it('отклонение требует основания', () => {
    expectError(
      () => assertDocumentTransition(doc('REVIEW'), { toStatus: 'REJECTED' }),
      'VALIDATION_ERROR',
    )
    expect(() =>
      assertDocumentTransition(doc('REVIEW'), {
        toStatus: 'REJECTED',
        comment: 'Не хватает приложения',
      }),
    ).not.toThrow()
  })

  it('возврат с согласования на доработку требует основания', () => {
    expectError(
      () => assertDocumentTransition(doc('REVIEW'), { toStatus: 'DRAFT' }),
      'VALIDATION_ERROR',
    )
  })

  it('согласованный документ подписывается без комментария', () => {
    expect(() =>
      assertDocumentTransition(doc('APPROVED'), { toStatus: 'SIGNED' }),
    ).not.toThrow()
  })

  it('отклонённый документ возвращается в черновик', () => {
    expect(() =>
      assertDocumentTransition(doc('REJECTED'), { toStatus: 'DRAFT' }),
    ).not.toThrow()
  })
})

describe('редактирование документа', () => {
  it('черновик и документ на согласовании правятся', () => {
    expect(() => assertDocumentEditable('DRAFT')).not.toThrow()
    expect(() => assertDocumentEditable('REVIEW')).not.toThrow()
  })

  it('подписанный и архивный документ не правятся', () => {
    expectError(() => assertDocumentEditable('SIGNED'), 'CONFLICT')
    expectError(() => assertDocumentEditable('ARCHIVED'), 'CONFLICT')
  })
})

describe('привязка документа', () => {
  it('без единой привязки документ не создаётся', () => {
    expectError(() => assertHasLink({}), 'VALIDATION_ERROR')
    expectError(
      () => assertHasLink({ cooperationId: null, universityId: null, programId: null }),
      'VALIDATION_ERROR',
    )
  })

  it('любой одной привязки достаточно', () => {
    expect(() => assertHasLink({ cooperationId: 'coop-1' })).not.toThrow()
    expect(() => assertHasLink({ universityId: 'uni-1' })).not.toThrow()
    expect(() => assertHasLink({ programId: 'prog-1' })).not.toThrow()
  })
})

describe('нумерация версий', () => {
  it('числовая версия растёт на единицу', () => {
    expect(nextVersion('1')).toBe('2')
    expect(nextVersion('9')).toBe('10')
  })

  it('версия с точкой наращивает последнее число', () => {
    expect(nextVersion('Приложение А.1')).toBe('Приложение А.2')
    expect(nextVersion('2.5')).toBe('2.6')
  })

  it('нечисловая версия получает суффикс и не теряет обозначение', () => {
    expect(nextVersion('Приложение А')).toBe('Приложение А.2')
  })
})

describe('валидация документа', () => {
  const valid = {
    cooperationId: 'coop-1',
    type: 'AGREEMENT',
    title: 'Договор о сотрудничестве',
  }

  it('версия по умолчанию — 1', () => {
    const parsed = createDocumentSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.version).toBe('1')
  })

  it('отклоняет некорректную ссылку на документ', () => {
    expect(
      createDocumentSchema.safeParse({ ...valid, fileReference: 'не-ссылка' }).success,
    ).toBe(false)
  })

  it('отклоняет неизвестный тип документа', () => {
    expect(createDocumentSchema.safeParse({ ...valid, type: 'INVOICE' }).success).toBe(false)
  })

  it('не принимает пустое тело изменения', () => {
    expect(updateDocumentSchema.safeParse({}).success).toBe(false)
  })

  it('при изменении не подставляет версию по умолчанию', () => {
    const parsed = updateDocumentSchema.safeParse({ title: 'Новое название документа' })
    expect(parsed.success && 'version' in parsed.data).toBe(false)
  })

  it('фильтр списка приводит одиночный статус к массиву', () => {
    expect(documentListQuerySchema.parse({ status: 'SIGNED' }).status).toEqual(['SIGNED'])
  })
})
