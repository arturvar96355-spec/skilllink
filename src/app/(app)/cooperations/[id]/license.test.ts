import { describe, expect, it } from 'vitest'
import { buildLicensePatch, licenseFormValues, licenseTermYearsText, type LicenseFormValues } from './license'

function form(patch: Partial<LicenseFormValues> = {}): LicenseFormValues {
  return {
    contractNumber: '',
    licenseSignedAt: '',
    licenseTermYears: '',
    transferStatus: '',
    comment: '',
    ...patch,
  }
}

describe('licenseFormValues', () => {
  it('переносит значения связки в поля формы', () => {
    expect(
      licenseFormValues({
        contractNumber: 'Д-42',
        licenseSignedAt: '2026-07-01T00:00:00.000Z',
        licenseTermYears: 3,
        transferStatus: 'TRANSFERRED',
        comment: 'Передано в срок',
      }),
    ).toEqual({
      contractNumber: 'Д-42',
      licenseSignedAt: '2026-07-01',
      licenseTermYears: '3',
      transferStatus: 'TRANSFERRED',
      comment: 'Передано в срок',
    })
  })

  it('незаполненные поля связки — пустые строки формы, а не null и не «0»', () => {
    expect(
      licenseFormValues({
        contractNumber: null,
        licenseSignedAt: null,
        licenseTermYears: null,
        transferStatus: null,
        comment: null,
      }),
    ).toEqual({ contractNumber: '', licenseSignedAt: '', licenseTermYears: '', transferStatus: '', comment: '' })
  })
})

describe('buildLicensePatch', () => {
  it('заполненная форма — все пять полей в теле PATCH', () => {
    expect(
      buildLicensePatch(
        form({
          contractNumber: '  Д-42  ',
          licenseSignedAt: '2026-07-01',
          licenseTermYears: '3',
          transferStatus: 'TRANSFERRED',
          comment: '  Передано в срок  ',
        }),
      ),
    ).toEqual({
      contractNumber: 'Д-42',
      licenseSignedAt: '2026-07-01T00:00:00.000Z',
      licenseTermYears: 3,
      transferStatus: 'TRANSFERRED',
      comment: 'Передано в срок',
    })
  })

  it('пустое поле стирает значение — null, а не пропускается и не «0»', () => {
    expect(buildLicensePatch(form())).toEqual({
      contractNumber: null,
      licenseSignedAt: null,
      licenseTermYears: null,
      transferStatus: null,
      comment: null,
    })
  })
})

describe('licenseTermYearsText', () => {
  it('число — словами по числу: год, года, лет', () => {
    expect(licenseTermYearsText(1)).toBe('1 год')
    expect(licenseTermYearsText(3)).toBe('3 года')
    expect(licenseTermYearsText(5)).toBe('5 лет')
  })

  it('не заполнено — «Нет данных», а не «0»', () => {
    expect(licenseTermYearsText(null)).toBe('Нет данных')
  })
})
