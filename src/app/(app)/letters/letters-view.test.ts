import { describe, expect, it } from 'vitest'
import {
  analyzedByNote,
  buildLettersFilterQuery,
  formatLetterConfidence,
  highlightQuotes,
  letterGroupStatsHint,
  letterGroupStatsText,
  type LettersFilters,
} from './letters-view'

const BASE_FILTERS: LettersFilters = {
  status: '',
  group: '',
  universityId: '',
  cooperationId: '',
  sort: '-receivedAt',
  page: 1,
  pageSize: 20,
}

describe('buildLettersFilterQuery', () => {
  it('пустые фильтры не попадают в запрос', () => {
    expect(buildLettersFilterQuery(BASE_FILTERS)).toEqual({
      status: undefined,
      group: undefined,
      universityId: undefined,
      cooperationId: undefined,
      sort: '-receivedAt',
      page: 1,
      pageSize: 20,
    })
  })

  it('заданные фильтры проходят как есть', () => {
    const query = buildLettersFilterQuery({
      ...BASE_FILTERS,
      status: 'NEW',
      group: 'MEETING',
      universityId: 'uni-1',
      cooperationId: 'coop-1',
      page: 3,
    })
    expect(query).toMatchObject({
      status: 'NEW',
      group: 'MEETING',
      universityId: 'uni-1',
      cooperationId: 'coop-1',
      page: 3,
    })
  })
})

describe('formatLetterConfidence', () => {
  it('null — «Нет данных»: письмо ещё не разобрано', () => {
    expect(formatLetterConfidence(null)).toBe('Нет данных')
  })

  it('доля округляется целым процентом', () => {
    expect(formatLetterConfidence(0.777)).toBe('78%')
    expect(formatLetterConfidence(0)).toBe('0%')
    expect(formatLetterConfidence(1)).toBe('100%')
  })
})

describe('analyzedByNote', () => {
  it('письмо ещё не разобрано', () => {
    expect(analyzedByNote({ analyzedBy: null, fallbackReason: null })).toBe('Ещё не разобрано')
  })

  it('разобрано моделью', () => {
    expect(analyzedByNote({ analyzedBy: 'MODEL', fallbackReason: null })).toBe('Разобрано моделью')
  })

  it('разобрано правилами без причины (данные до решения — на всякий случай)', () => {
    expect(analyzedByNote({ analyzedBy: 'RULES', fallbackReason: null })).toBe('Разобрано правилами')
  })

  it('разобрано правилами, потому что модель недоступна — причина честно названа', () => {
    expect(analyzedByNote({ analyzedBy: 'RULES', fallbackReason: 'disabled' })).toBe(
      'Разобрано правилами — модель недоступна: помощник не подключён',
    )
    expect(analyzedByNote({ analyzedBy: 'RULES', fallbackReason: 'not-configured' })).toContain(
      'нет ключа доступа',
    )
  })
})

describe('highlightQuotes', () => {
  it('без цитат — один сплошной сегмент', () => {
    expect(highlightQuotes('Добрый день', [])).toEqual([{ text: 'Добрый день', isQuote: false }])
  })

  it('находит цитату без учёта регистра и подсвечивает только её', () => {
    const segments = highlightQuotes('Просим выслать оригинал договора.', ['выслать оригинал'])
    expect(segments).toEqual([
      { text: 'Просим ', isQuote: false },
      { text: 'выслать оригинал', isQuote: true },
      { text: ' договора.', isQuote: false },
    ])
  })

  it('цитата, которой нет в тексте, пропускается', () => {
    expect(highlightQuotes('Текст письма.', ['такого нет'])).toEqual([
      { text: 'Текст письма.', isQuote: false },
    ])
  })

  it('несколько цитат по тексту — каждая своим сегментом', () => {
    const segments = highlightQuotes('Просим перенести встречу на среду, документы пришлём позже.', [
      'перенести встречу',
      'документы пришлём',
    ])
    expect(segments.filter((s) => s.isQuote).map((s) => s.text)).toEqual([
      'перенести встречу',
      'документы пришлём',
    ])
    expect(segments.map((s) => s.text).join('')).toBe(
      'Просим перенести встречу на среду, документы пришлём позже.',
    )
  })

  it('пересекающиеся цитаты объединяются в один сегмент без пропуска и повтора символов', () => {
    const segments = highlightQuotes('нужно перенести встречу на завтра', [
      'нужно перенести',
      'перенести встречу',
    ])
    expect(segments.map((s) => s.text).join('')).toBe('нужно перенести встречу на завтра')
    expect(segments.filter((s) => s.isQuote)).toHaveLength(1)
    expect(segments.find((s) => s.isQuote)?.text).toBe('нужно перенести встречу')
  })

  it('пустой текст письма — пустой список сегментов', () => {
    expect(highlightQuotes('', ['что-то'])).toEqual([])
  })
})

describe('letterGroupStatsText / letterGroupStatsHint', () => {
  it('группа без проверенных писем', () => {
    const stat = { group: 'MEETING' as const, totalReviewed: 0, totalCorrect: 0, accuracy: null, sampleEff: 0 }
    expect(letterGroupStatsText(stat)).toBe('Встреча — ещё нет проверенных писем')
    expect(letterGroupStatsHint(stat)).toBe('Наблюдений ещё не было')
  })

  it('группа со счётчиками — «верно N из M»', () => {
    const stat = {
      group: 'STAGE_SHIFT' as const,
      totalReviewed: 10,
      totalCorrect: 9,
      accuracy: 0.78,
      sampleEff: 4.6,
    }
    expect(letterGroupStatsText(stat)).toBe('Сдвиг этапа — верно 9 из 10')
    expect(letterGroupStatsHint(stat)).toContain('78%')
  })
})
