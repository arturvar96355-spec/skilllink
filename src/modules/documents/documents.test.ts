import { describe, expect, it } from 'vitest'
import { AppError } from '@/shared/http/errors'
import {
  DOCUMENT_TEMPLATES,
  MISSING_PLACEHOLDER,
  TEMPLATE_BY_KEY,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_PLACEHOLDER_LABELS,
  placeholderLabel,
} from '@/shared/config/document-templates.config'
import {
  ALLOWED_DOCUMENT_TRANSITIONS,
  assertDocumentEditable,
  assertDocumentHasContent,
  assertDocumentTransition,
  assertHasLink,
  findExistingForTemplate,
  nextVersion,
  packageSkipReason,
  positionInText,
  renderTemplate,
  SKIP_REASON_NO_PRODUCT,
  type ExistingPackageDocument,
  areSigningDocumentsSigned,
} from './documents.rules'
import {
  createDocumentSchema,
  documentListQuerySchema,
  generateDocumentsSchema,
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

  it('на согласование нельзя отправить пустой документ', () => {
    expectError(
      () => assertDocumentTransition(doc('DRAFT', null), { toStatus: 'REVIEW' }),
      'VALIDATION_ERROR',
    )
  })

  it('собранный из шаблона текст заменяет ссылку на файл', () => {
    // Сгенерированный документ — это и есть документ: требовать вдобавок файл незачем.
    expect(() =>
      assertDocumentTransition(
        { status: 'DRAFT', fileReference: null, content: 'ДОГОВОР О СОТРУДНИЧЕСТВЕ…' },
        { toStatus: 'REVIEW' },
      ),
    ).not.toThrow()
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

  it('ссылка на документ — только http или https', () => {
    for (const fileReference of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///C:/doc.pdf']) {
      expect(createDocumentSchema.safeParse({ ...valid, fileReference }).success, fileReference).toBe(false)
      expect(updateDocumentSchema.safeParse({ fileReference }).success, fileReference).toBe(false)
    }
    expect(
      createDocumentSchema.safeParse({ ...valid, fileReference: 'https://example.invalid/doc.pdf' }).success,
    ).toBe(true)
    expect(updateDocumentSchema.safeParse({ fileReference: 'https://example.invalid/doc.pdf' }).success).toBe(true)
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

describe('подстановка реквизитов в шаблон', () => {
  const context = {
    'university.name': 'СПбГУТ',
    'program.name': 'Программная инженерия',
    'product.name': null,
  }

  it('подставляет известные реквизиты', () => {
    const result = renderTemplate('Вуз: {{university.name}}', context)
    expect(result.text).toBe('Вуз: СПбГУТ')
    expect(result.missing).toEqual([])
  })

  it('недостающий реквизит становится видимым прочерком, а не пустотой', () => {
    const result = renderTemplate('Продукт: {{product.name}}', context)
    expect(result.text).toBe(`Продукт: ${MISSING_PLACEHOLDER}`)
    expect(result.missing).toEqual(['product.name'])
  })

  it('неизвестный реквизит тоже попадает в список недостающих', () => {
    const result = renderTemplate('{{unknown.field}}', context)
    expect(result.missing).toEqual(['unknown.field'])
  })

  it('один и тот же реквизит не дублируется в списке', () => {
    const result = renderTemplate('{{product.name}} и ещё раз {{product.name}}', context)
    expect(result.missing).toEqual(['product.name'])
  })

  it('терпит пробелы внутри скобок', () => {
    expect(renderTemplate('{{  university.name  }}', context).text).toBe('СПбГУТ')
  })

  it('пустая строка считается отсутствующим значением', () => {
    const result = renderTemplate('{{empty}}', { empty: '   ' })
    expect(result.missing).toEqual(['empty'])
  })

  it('текст без подстановок не меняется', () => {
    expect(renderTemplate('Просто текст', context).text).toBe('Просто текст')
  })
})

describe('набор шаблонов', () => {
  it('ключи уникальны', () => {
    const keys = DOCUMENT_TEMPLATES.map((template) => template.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('в пакет по умолчанию входит несколько документов', () => {
    expect(DOCUMENT_TEMPLATES.filter((template) => template.inDefaultPackage).length).toBeGreaterThan(1)
  })

  it('у каждого шаблона есть описание и непустое тело', () => {
    expect(
      DOCUMENT_TEMPLATES.every(
        (template) => template.description.length > 0 && template.body.length > 0,
      ),
    ).toBe(true)
  })

  it('служебные пометки не попадают в текст документа', () => {
    // Неутверждённость текстов отмечена комментарием у конфига. В самом документе
    // строка «TEMP: болванка для демонстрации» уходила вузу на согласование.
    for (const template of DOCUMENT_TEMPLATES) {
      expect(`${template.title}\n${template.body}`).not.toMatch(/TEMP|болванк/i)
    }
  })

  it('название школы везде одно — «ИТ-Школа РТК»', () => {
    for (const template of DOCUMENT_TEMPLATES) {
      // Любое упоминание школы — ровно «ИТ-Школа/Школы РТК», без «IT Школа» и вариантов.
      expect(template.body).not.toMatch(/(?<!ИТ-)Школ[а-я]* РТК/)
    }
  })

  it('тексты не требуют склонять ФИО и должность', () => {
    // «в лице {{contact.fullName}}» давало «в лице Ветрова Ирина Павловна»:
    // родительного падежа из карточки не получить.
    for (const template of DOCUMENT_TEMPLATES) {
      expect(template.body).not.toMatch(/в лице/i)
    }
  })

  it('у каждого шаблона есть название по-русски', () => {
    for (const template of DOCUMENT_TEMPLATES) {
      expect(template.name).toMatch(/[а-яА-Я]/)
      expect(template.name).not.toContain('{{')
    }
  })

  it('лицензия без продукта не собирается, остальные — собираются', () => {
    expect(TEMPLATE_BY_KEY.get('license')?.requiresProduct).toBe(true)
    expect(TEMPLATE_BY_KEY.get('agreement')?.requiresProduct).toBeFalsy()
  })
})

describe('подписи реквизитов', () => {
  it('у каждого реквизита есть подпись по-русски', () => {
    for (const key of TEMPLATE_PLACEHOLDERS) {
      expect(TEMPLATE_PLACEHOLDER_LABELS[key]).toMatch(/[а-яА-Я]/)
    }
  })

  it('каждая подстановка в шаблонах — из списка реквизитов с подписью', () => {
    const known = new Set<string>(TEMPLATE_PLACEHOLDERS)
    for (const template of DOCUMENT_TEMPLATES) {
      for (const match of `${template.title}${template.body}`.matchAll(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g)) {
        expect(known.has(match[1]!), `${template.key}: ${match[1]}`).toBe(true)
      }
    }
  })

  it('вместо ключа — название', () => {
    expect(['product.name', 'product.version'].map(placeholderLabel)).toEqual([
      'название IT-продукта',
      'версия IT-продукта',
    ])
  })

  it('неизвестный ключ показывается как есть, а не пропадает', () => {
    expect(placeholderLabel('unknown.field')).toBe('unknown.field')
  })
})

describe('должность в тексте документа', () => {
  it('внутри фразы пишется со строчной', () => {
    expect(positionInText('Заместитель декана')).toBe('заместитель декана')
  })

  it('аббревиатура не портится', () => {
    expect(positionInText('ИТ-директор')).toBe('ИТ-директор')
    expect(positionInText('CIO')).toBe('CIO')
  })

  it('нет должности — нет значения, и в тексте будет прочерк', () => {
    expect(positionInText(null)).toBeNull()
    expect(positionInText('   ')).toBeNull()
  })
})

describe('что пакет документов не пересобирает', () => {
  const agreement = TEMPLATE_BY_KEY.get('agreement')!
  const license = TEMPLATE_BY_KEY.get('license')!
  const existing = (overrides: Partial<ExistingPackageDocument>): ExistingPackageDocument => ({
    title: 'Договор о сотрудничестве — СПбГУТ',
    type: 'AGREEMENT',
    status: 'DRAFT',
    templateKey: 'agreement',
    ...overrides,
  })

  it('собранный из шаблона документ закрывает шаблон', () => {
    const reason = packageSkipReason(agreement, { documents: [existing({})], hasProduct: true })
    expect(reason).toBe('уже есть: «Договор о сотрудничестве — СПбГУТ», черновик')
  })

  it('договор, заведённый вручную, тоже закрывает шаблон', () => {
    // Раньше сверка шла только по ключу шаблона, и пакет добавлял второй договор.
    const manual = existing({ title: 'Договор сквозного сценария', templateKey: null, status: 'SIGNED' })
    expect(packageSkipReason(agreement, { documents: [manual], hasProduct: true })).toBe(
      'уже есть: «Договор сквозного сценария», подписан',
    )
  })

  it('архивный документ шаблон не закрывает', () => {
    const archived = existing({ status: 'ARCHIVED' })
    expect(packageSkipReason(agreement, { documents: [archived], hasProduct: true })).toBeNull()
  })

  it('документ другого типа шаблон не закрывает', () => {
    const nda = existing({ type: 'NDA', templateKey: 'nda', title: 'Соглашение' })
    expect(packageSkipReason(agreement, { documents: [nda], hasProduct: true })).toBeNull()
  })

  it('совпадение по ключу шаблона важнее совпадения по типу', () => {
    const manual = existing({ title: 'Ручной', templateKey: null })
    const generated = existing({ title: 'Из шаблона' })
    expect(findExistingForTemplate(agreement, [manual, generated])?.title).toBe('Из шаблона')
  })

  it('force пересобирает существующий', () => {
    expect(
      packageSkipReason(agreement, { documents: [existing({})], hasProduct: true, force: true }),
    ).toBeNull()
  })

  it('лицензия без продукта не собирается даже с force', () => {
    expect(packageSkipReason(license, { documents: [], hasProduct: false })).toBe(SKIP_REASON_NO_PRODUCT)
    expect(packageSkipReason(license, { documents: [], hasProduct: false, force: true })).toBe(
      SKIP_REASON_NO_PRODUCT,
    )
    expect(SKIP_REASON_NO_PRODUCT).toBe('не выбран IT-продукт — выберите его в связке')
  })

  it('договор без продукта собирается — продукт в нём упомянут попутно', () => {
    expect(packageSkipReason(agreement, { documents: [], hasProduct: false })).toBeNull()
  })
})

describe('запрос на сборку пакета', () => {
  it('работает без тела: собирается пакет по умолчанию', () => {
    expect(generateDocumentsSchema.safeParse({}).success).toBe(true)
  })

  it('принимает список шаблонов', () => {
    expect(generateDocumentsSchema.safeParse({ templateKeys: ['nda', 'agreement'] }).success).toBe(
      true,
    )
  })

  it('отклоняет пустой ключ шаблона', () => {
    expect(generateDocumentsSchema.safeParse({ templateKeys: [''] }).success).toBe(false)
  })
})

describe('содержимое документа дальше черновика', () => {
  it('у утверждённого документа ссылку не стереть, если нет текста', () => {
    // Раньше правка ссылки правилам не подчинялась: стёртый файл, затем «Подписан».
    expectError(
      () => assertDocumentHasContent({ status: 'APPROVED', fileReference: null, content: null }),
      'VALIDATION_ERROR',
    )
  })

  it('текст из шаблона — тоже содержимое', () => {
    expect(() =>
      assertDocumentHasContent({ status: 'APPROVED', fileReference: null, content: 'Договор…' }),
    ).not.toThrow()
  })

  it('черновик и отклонённый могут быть пустыми', () => {
    expect(() => assertDocumentHasContent({ status: 'DRAFT', fileReference: null })).not.toThrow()
    expect(() => assertDocumentHasContent({ status: 'REJECTED', fileReference: null })).not.toThrow()
  })

  it('подписать пустой нельзя и переходом', () => {
    expectError(
      () => assertDocumentTransition({ status: 'APPROVED', fileReference: null, content: null }, { toStatus: 'SIGNED' }),
      'VALIDATION_ERROR',
    )
  })
})

describe('подпись документов отмечает этап 6 (решение 87)', () => {
  it('договор подписан, других документов на подпись нет — документы подписаны', () => {
    expect(areSigningDocumentsSigned([{ type: 'AGREEMENT', status: 'SIGNED' }])).toBe(true)
  })

  it('договор и лицензия подписаны — документы подписаны', () => {
    expect(
      areSigningDocumentsSigned([
        { type: 'AGREEMENT', status: 'SIGNED' },
        { type: 'LICENSE', status: 'SIGNED' },
      ]),
    ).toBe(true)
  })

  it('лицензия подписана, а договор на согласовании — ещё нет', () => {
    expect(
      areSigningDocumentsSigned([
        { type: 'AGREEMENT', status: 'REVIEW' },
        { type: 'LICENSE', status: 'SIGNED' },
      ]),
    ).toBe(false)
  })

  it('договор подписан, а второй договор ещё ждёт подписи — ещё нет', () => {
    for (const status of ['DRAFT', 'REVIEW', 'APPROVED'] as const) {
      expect(
        areSigningDocumentsSigned([
          { type: 'AGREEMENT', status: 'SIGNED' },
          { type: 'AGREEMENT', status },
        ]),
      ).toBe(false)
    }
  })

  it('лицензию этап 6 не ждёт: она передаётся на этапе 7', () => {
    for (const status of ['DRAFT', 'REVIEW', 'APPROVED'] as const) {
      expect(
        areSigningDocumentsSigned([
          { type: 'AGREEMENT', status: 'SIGNED' },
          { type: 'LICENSE', status },
        ]),
      ).toBe(true)
    }
  })

  it('без подписанного договора — нет, даже если лицензия подписана', () => {
    expect(areSigningDocumentsSigned([{ type: 'LICENSE', status: 'SIGNED' }])).toBe(false)
    expect(areSigningDocumentsSigned([])).toBe(false)
  })

  it('отклонённый и архивный документ подписи не ждут', () => {
    expect(
      areSigningDocumentsSigned([
        { type: 'AGREEMENT', status: 'SIGNED' },
        { type: 'AGREEMENT', status: 'REJECTED' },
        { type: 'LICENSE', status: 'ARCHIVED' },
      ]),
    ).toBe(true)
  })

  it('другие документы (соглашение о неразглашении, учебный план) не мешают', () => {
    expect(
      areSigningDocumentsSigned([
        { type: 'AGREEMENT', status: 'SIGNED' },
        { type: 'NDA', status: 'DRAFT' },
        { type: 'CURRICULUM', status: 'REVIEW' },
      ]),
    ).toBe(true)
  })
})
