import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'
import { findRanges, normalize, queryTerms, searchDocs, snippetOf, type DocsIndexEntry } from './docs-search'

/**
 * Публичная документация (решение 214): открыта без входа и не показывает
 * данных системы. Второе проверяется по исходникам: ни одного обращения к API,
 * базе, модулям бизнес-логики или текущей сессии — только реестр shared/help.
 */
const DIR = join(process.cwd(), 'src', 'app', 'docs')
const SOURCES = readdirSync(DIR)
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))
  .map((name) => [name, readFileSync(join(DIR, name), 'utf8')] as const)

describe('страница /docs', () => {
  it('открывается без сессии — без перенаправления на вход', () => {
    const response = middleware(new NextRequest('https://skilllink.test/docs'))
    expect(response.headers.get('location')).toBeNull()
  })

  it.each(SOURCES)('%s не берёт данные из базы и API', (_name, source) => {
    expect(source).not.toMatch(/@\/shared\/db|@\/modules\/|@prisma|@\/generated/)
    expect(source).not.toMatch(/\bfetch\(|apiGet|apiPost|useResource|\/api\//)
    expect(source).not.toMatch(/getCurrentUser|useSession|next-auth/)
  })
})

describe('поиск по документации', () => {
  const index: DocsIndexEntry[] = [
    { id: 'deadlines', title: 'Сроки и просрочки', group: 'Работа со связками', text: 'Срок этапа считается от даты создания связки.' },
    { id: 'telegram', title: 'Telegram-бот', group: 'Уведомления и боты', text: 'Команды /today и /stop.' },
    { id: 'dsar', title: 'Запросы субъектов', group: 'Администрирование и 152-ФЗ', text: 'Сведения о себе по 152-ФЗ, ст. 14.' },
    { id: 'meetings', title: 'Встречи', group: 'Работа со связками', text: 'Следующий шаг без срока не принимается.' },
  ]

  it('без учёта регистра и «ё»', () => {
    expect(normalize('ЁЖ Срок')).toBe('еж срок')
    expect(queryTerms('  Срок   срок ')).toEqual(['срок'])
  })

  it('«срок» находит раздел по заголовку раньше, чем по тексту', () => {
    expect(searchDocs(index, 'срок').map((hit) => hit.id)).toEqual(['deadlines', 'meetings'])
  })

  it('«152» и «telegram» находят по группе и заголовку', () => {
    expect(searchDocs(index, '152').map((hit) => hit.id)).toEqual(['dsar'])
    expect(searchDocs(index, 'TELEGRAM').map((hit) => hit.id)).toEqual(['telegram'])
  })

  it('все слова запроса должны найтись; одна буква не ищется', () => {
    expect(searchDocs(index, 'срок встреча')).toEqual([])
    expect(searchDocs(index, 'с')).toEqual([])
  })

  it('отрывок подсвечивает совпадения', () => {
    const parts = snippetOf('Следующий шаг без срока не принимается.', ['срок'])
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(['срок'])
    expect(findRanges('Срок и ещё срок', ['срок'])).toEqual([
      [0, 4],
      [11, 15],
    ])
  })
})
