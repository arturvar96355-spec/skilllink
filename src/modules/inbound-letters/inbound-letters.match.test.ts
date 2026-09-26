import { describe, expect, it } from 'vitest'
import { domainFromWebsite, emailDomain, matchUniversityByDomain } from './inbound-letters.match'

describe('emailDomain', () => {
  it('домен после @, в нижнем регистре', () => {
    expect(emailDomain('Priemnaya@SPBGUT.example.invalid')).toBe('spbgut.example.invalid')
  })

  it('без «@» — null', () => {
    expect(emailDomain('не почта')).toBeNull()
  })

  it('«@» последним символом — null', () => {
    expect(emailDomain('kто-то@')).toBeNull()
  })
})

describe('domainFromWebsite', () => {
  it('убирает протокол и www', () => {
    expect(domainFromWebsite('https://www.sut.ru/about')).toBe('sut.ru')
    expect(domainFromWebsite('sut.ru')).toBe('sut.ru')
    expect(domainFromWebsite('http://sut.ru')).toBe('sut.ru')
  })

  it('пустая строка или мусор — null', () => {
    expect(domainFromWebsite('')).toBeNull()
    expect(domainFromWebsite('   ')).toBeNull()
  })
})

describe('matchUniversityByDomain: вуз по адресу отправителя (решение 170)', () => {
  const candidates = [
    { universityId: 'uni-1', domains: ['sut.ru', 'priemnaya.sut.ru'] },
    { universityId: 'uni-2', domains: ['mtuci.ru'] },
  ]

  it('находит вуз по домену сайта', () => {
    expect(matchUniversityByDomain('rector@sut.ru', candidates)).toBe('uni-1')
  })

  it('находит вуз по домену почты контакта (не только по сайту)', () => {
    expect(matchUniversityByDomain('ivanova@priemnaya.sut.ru', candidates)).toBe('uni-1')
    expect(matchUniversityByDomain('rector@mtuci.ru', candidates)).toBe('uni-2')
  })

  it('общий бесплатный провайдер не выдаёт вуз, даже если случайно совпал бы', () => {
    expect(matchUniversityByDomain('someone@gmail.com', candidates)).toBeNull()
    expect(matchUniversityByDomain('someone@yandex.ru', candidates)).toBeNull()
  })

  it('домен не встречается ни у одного вуза — null', () => {
    expect(matchUniversityByDomain('someone@unknown-university.example.invalid', candidates)).toBeNull()
  })

  it('некорректный адрес — null, без исключения', () => {
    expect(matchUniversityByDomain('не почта', candidates)).toBeNull()
  })
})
