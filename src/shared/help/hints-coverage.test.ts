import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { HELP_TOOLS } from './tools'
import { HELP_TOPICS } from './topics'

/**
 * «?» у каждого экрана и каждого инструмента (решение 217) — проверка по исходникам.
 *
 * 1. Каждый экран `src/app/(app)/**\/page.tsx` ставит `help` у своего `PageHeader` —
 *    сам или в компоненте, который он рендерит (отчёты по ТЗ — `ReportTablePage`).
 *    Новая страница без «?» у заголовка — красный тест, а не забытое место.
 * 2. Каждый раздел и подраздел, названный в разметке (`<HelpHint topic section>` и
 *    `help={{ topic, section }}`), есть в реестре. Типы это уже не пропускают;
 *    тест — вторая линия для строк, собранных не литералом.
 *
 * Разбор — компилятором TypeScript, а не регулярными выражениями: атрибут на
 * другой строке или в фигурных скобках находится так же надёжно.
 */

const SRC = join(process.cwd(), 'src')
const APP = join(SRC, 'app', '(app)')

/** Экраны, у которых «?» у заголовка не нужен, — с причиной. */
const EXEMPT: Record<string, string> = {
  'help/page.tsx': 'сама справка: «?» у её заголовка вёл бы на неё же',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** Локальные импорты файла: `./x`, `../x` и `@/app/...` — то, что экран рисует сам. */
function localImports(file: string, source: ts.SourceFile): string[] {
  const out: string[] = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const spec = statement.moduleSpecifier.text
    const base = spec.startsWith('.')
      ? resolve(dirname(file), spec)
      : spec.startsWith('@/app/')
        ? join(SRC, spec.slice(2))
        : null
    if (!base) continue
    for (const candidate of [`${base}.tsx`, join(base, 'index.tsx')]) {
      try {
        if (statSync(candidate).isFile()) out.push(candidate)
      } catch {
        // нет такого файла — не компонент
      }
    }
  }
  return out
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText()
}

function attribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  )
}

function forEachJsx(source: ts.SourceFile, visit: (node: ts.JsxOpeningLikeElement) => void): void {
  const walkNode = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) visit(node)
    ts.forEachChild(node, walkNode)
  }
  walkNode(source)
}

/** Есть ли в файле или в том, что он рендерит, `<PageHeader help=…>`. */
function hasHeaderHelp(file: string, seen = new Set<string>(), depth = 0): boolean {
  if (seen.has(file) || depth > 3) return false
  seen.add(file)
  const source = parse(file)
  let found = false
  forEachJsx(source, (node) => {
    if (tagName(node) === 'PageHeader' && attribute(node, 'help')) found = true
  })
  if (found) return true
  return localImports(file, source).some((next) => hasHeaderHelp(next, seen, depth + 1))
}

const pages = walk(APP)
  .filter((file) => file.endsWith('page.tsx'))
  .map((file) => relative(APP, file))
  .sort()

describe('«?» у заголовка каждого экрана', () => {
  it('экраны нашлись', () => {
    expect(pages.length).toBeGreaterThanOrEqual(25)
  })

  it.each(pages.filter((page) => !(page in EXEMPT)).map((page) => [page]))('%s', (page) => {
    expect(hasHeaderHelp(join(APP, page)), `${page}: у PageHeader нет help={{ topic: … }}`).toBe(true)
  })

  it('исключения — только существующие экраны', () => {
    for (const page of Object.keys(EXEMPT)) expect(pages).toContain(page)
  })
})

interface HelpUse {
  file: string
  topic: string
  section: string | null
}

/** Строка литерала из атрибута `topic="x"` / `topic={'x'}` или свойства объекта `topic: 'x'`. */
function literal(node: ts.Node | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isJsxExpression(node)) return literal(node.expression)
  return null
}

function objectHelp(node: ts.ObjectLiteralExpression): { topic: string | null; section: string | null } {
  const read = (key: string) => {
    const property = node.properties.find(
      (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && item.name.getText() === key,
    )
    return property ? literal(property.initializer) : null
  }
  return { topic: read('topic'), section: read('section') }
}

function collectUses(): HelpUse[] {
  const files = [...walk(join(SRC, 'app')), ...walk(join(SRC, 'ui'))].filter((file) => file.endsWith('.tsx'))
  const uses: HelpUse[] = []
  for (const file of files) {
    const source = parse(file)
    const rel = relative(SRC, file)
    forEachJsx(source, (node) => {
      if (tagName(node) === 'HelpHint') {
        const topic = literal(attribute(node, 'topic')?.initializer)
        if (topic) uses.push({ file: rel, topic, section: literal(attribute(node, 'section')?.initializer) })
      }
    })
    // help={{ topic: 'x', section: 'y' }} у PageHeader, Section, Modal, Row… и такие же объекты в данных.
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const { topic, section } = objectHelp(node)
        if (topic && topic in HELP_TOPICS) uses.push({ file: rel, topic, section })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return uses
}

describe('разделы и подразделы в разметке есть в реестре', () => {
  const uses = collectUses()
  const tools = HELP_TOOLS as Readonly<Record<string, Readonly<Record<string, unknown>>>>

  it('«?» стоит во многих местах, а не на трёх примерах', () => {
    expect(uses.length).toBeGreaterThanOrEqual(150)
  })

  it.each(uses.map((use) => [`${use.file}: ${use.topic}${use.section ? `--${use.section}` : ''}`, use] as const))(
    '%s',
    (_label, use) => {
      expect(use.topic in HELP_TOPICS, `нет раздела «${use.topic}»`).toBe(true)
      if (use.section) expect(tools[use.topic]?.[use.section], `нет подраздела «${use.topic}--${use.section}»`).toBeDefined()
    },
  )

  it('почти каждый подраздел где-то открывается «?» — реестр не пишется впрок', () => {
    const used = new Set(uses.filter((use) => use.section).map((use) => `${use.topic}--${use.section}`))
    const all = Object.entries(tools).flatMap(([topic, sections]) => Object.keys(sections).map((key) => `${topic}--${key}`))
    const unused = all.filter((anchor) => !used.has(anchor))
    // Подраздел без «?» допустим, если на него ссылаются тексты других разделов
    // (например, «Скопировать id» — из «Запросов субъектов»), но таких единицы.
    expect(unused.length, `без «?»: ${unused.join(', ')}`).toBeLessThanOrEqual(3)
  })
})
