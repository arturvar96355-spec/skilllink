import { describe, expect, it } from 'vitest'
import { buildCreateDocumentInput, type DocumentFormValues, type DocumentLinkValues } from './document-create'

function form(patch: Partial<DocumentFormValues> = {}): DocumentFormValues {
  return {
    type: 'AGREEMENT',
    title: '',
    version: '',
    fileReference: '',
    responsibleId: '',
    issuedAt: '',
    ...patch,
  }
}

function links(patch: Partial<DocumentLinkValues> = {}): DocumentLinkValues {
  return { cooperationId: '', universityId: '', programId: '', ...patch }
}

describe('buildCreateDocumentInput', () => {
  it('заполненная форма — все поля в теле POST', () => {
    expect(
      buildCreateDocumentInput(
        form({
          type: 'LICENSE',
          title: '  Лицензионный договор  ',
          version: '2',
          fileReference: '  https://disk.example.ru/doc.pdf  ',
          responsibleId: 'user-1',
          issuedAt: '2026-05-01',
        }),
        links({ cooperationId: 'coop-1' }),
      ),
    ).toEqual({
      type: 'LICENSE',
      title: 'Лицензионный договор',
      version: '2',
      fileReference: 'https://disk.example.ru/doc.pdf',
      responsibleId: 'user-1',
      issuedAt: '2026-05-01T00:00:00.000Z',
      cooperationId: 'coop-1',
      universityId: null,
      programId: null,
    })
  })

  it('пустая версия не отправляется — сервер поставит значение по умолчанию', () => {
    const body = buildCreateDocumentInput(form({ title: 'Акт' }), links())
    expect('version' in body).toBe(false)
  })

  it('пустые необязательные поля — null, привязка не выбрана — null у всех трёх', () => {
    expect(buildCreateDocumentInput(form({ title: 'Акт' }), links())).toEqual({
      type: 'AGREEMENT',
      title: 'Акт',
      fileReference: null,
      responsibleId: null,
      issuedAt: null,
      cooperationId: null,
      universityId: null,
      programId: null,
    })
  })
})
