import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Значения оформления живут в одном месте.
 *
 * Дизайн-система запрещает придумывать цвета и размеры шрифта на страницах
 * (разделы 32–33 документа о цвете, 23 документа о шрифтах). Правило простое
 * и потому легко нарушается: один «почти такой же» фиолетовый в одной таблице —
 * и через неделю их пять. Проверка ловит это сразу.
 *
 * Сама дизайн-система (`src/ui`) под запрет не попадает: там эти значения
 * и должны быть — она их и определяет.
 */
const ROOT = process.cwd()

function pageStyles(): string[] {
  return globSync('src/app/**/*.module.css', { cwd: ROOT })
}

describe('оформление страниц', () => {
  it('находит файлы стилей страниц', () => {
    expect(pageStyles().length).toBeGreaterThan(5)
  })

  it.each(pageStyles())('%s не задаёт свои цвета', (file) => {
    const css = readFileSync(join(ROOT, file), 'utf8')
    const hexColors = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hexColors, `цвета задаются переменными из globals.css: ${hexColors.join(', ')}`).toEqual(
      [],
    )
  })

  it.each(pageStyles())('%s не задаёт свои размеры шрифта', (file) => {
    const css = readFileSync(join(ROOT, file), 'utf8')
    // Разрешены только переменные: font-size: var(--text-…).
    const sizes = (css.match(/font-size:\s*[^;]+;/g) ?? []).filter(
      (rule) => !rule.includes('var(--'),
    )
    expect(sizes, `размеры берутся из шкалы типографики: ${sizes.join(' ')}`).toEqual([])
  })

  /*
   * Колонка `1fr` не бывает уже своего содержимого: таблица с фиксированными
   * столбцами распирает её, и страница уезжает за край. Так на проекторе
   * 1280×720 главная давала прокрутку вбок, а на телефоне — на 364 пикселя:
   * там сетка складывается в одну колонку `1fr`, и одиночная колонка ведёт
   * себя так же. Доля задаётся через `minmax(0, …)`; `repeat(auto-fit, …)`
   * правилу не подлежит — у него своя нижняя граница.
   */
  it.each(pageStyles())('%s: колонки сетки умеют сжиматься', (file) => {
    const css = readFileSync(join(ROOT, file), 'utf8')
    const bare = (css.match(/grid-template-columns:\s*[^;]+;/g) ?? []).filter((rule) => {
      const value = rule.replace(/grid-template-columns:\s*/, '').replace(/;$/, '')
      if (value.includes('repeat(')) return false
      const withoutGuarded = value.replace(/minmax\([^)]*\)/g, '')
      const bareFractions = withoutGuarded.match(/\b\d*\.?\d+fr\b/g) ?? []
      return bareFractions.length > 0
    })
    expect(bare, `доли колонок — через minmax(0, …): ${bare.join(' ')}`).toEqual([])
  })
})

describe('переменные оформления', () => {
  it('каждая переменная, на которую ссылаются стили, объявлена', () => {
    const globals = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')
    const declared = new Set(
      [...globals.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]!),
    )

    const files = [
      ...globSync('src/app/**/*.module.css', { cwd: ROOT }),
      ...globSync('src/ui/**/*.module.css', { cwd: ROOT }),
    ]

    const missing: string[] = []
    for (const file of files) {
      const css = readFileSync(join(ROOT, file), 'utf8')
      // Своя переменная модуля (оттенок бирки программы) объявлена в нём же.
      const local = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]!))
      for (const match of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        const name = match[1]!
        // Переменная шрифта приходит из next/font и объявляется в разметке.
        if (name === '--font-inter') continue
        if (!declared.has(name) && !local.has(name)) missing.push(`${relative('.', file)}: ${name}`)
      }
    }

    expect(missing, `нет таких переменных: ${missing.join(', ')}`).toEqual([])
  })
})

/*
 * Единая шкала шрифтов и в самой дизайн-системе (бриф v2, 1.1): кегль числом
 * в компоненте — это второй, «почти такой же» размер. Исключения — инициалы
 * в аватаре (привязаны к диаметру кружка) и подписи внутри SVG карты, где
 * размер задаётся в единицах рисунка.
 */
describe('шрифты дизайн-системы', () => {
  const EXEMPT = new Set(['src/ui/primitives/Avatar.module.css', 'src/ui/data/RussiaMap.module.css'])
  const files = globSync('src/ui/**/*.module.css', { cwd: ROOT }).filter((file) => !EXEMPT.has(file))

  it.each(files)('%s берёт размер шрифта из шкалы', (file) => {
    const css = readFileSync(join(ROOT, file), 'utf8')
    const sizes = (css.match(/font-size:\s*[^;]+;/g) ?? []).filter((rule) => !rule.includes('var(--'))
    expect(sizes, `размеры — из шкалы типографики: ${sizes.join(' ')}`).toEqual([])
  })

  it.each(files)('%s не заводит свою гарнитуру', (file) => {
    const css = readFileSync(join(ROOT, file), 'utf8')
    const families = (css.match(/font-family:\s*[^;]+;/g) ?? []).filter((rule) => !rule.includes('var(--'))
    expect(families, `гарнитура — только --font-family или --font-mono: ${families.join(' ')}`).toEqual([])
  })
})
