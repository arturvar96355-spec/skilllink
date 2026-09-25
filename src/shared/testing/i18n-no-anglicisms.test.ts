import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Англицизмы в текстах системы (docs/GLOSSARY.md).
 *
 * Система для менеджеров партнёрств и представителей вузов: «дашборд»,
 * «дедлайн» и «апрувнуть» им ничего не объясняют, а один и тот же смысл,
 * названный двумя словами, выглядит как две разные вещи.
 *
 * Тест разбирает исходники компилятором TypeScript и смотрит только на текст:
 * JSX, строковые и шаблонные литералы, в которых есть кириллица. Комментарии,
 * регулярные выражения, имена переменных и строки без кириллицы (коды, пути,
 * имена полей) не проверяются. Файлы тестов тоже: их названия — не интерфейс.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Буква кириллицы или латиницы: граница слова, которую `\b` для кириллицы не видит. */
const LETTER = '[а-яёa-z]'
const word = (stem: string): RegExp => new RegExp(`(?<!${LETTER})(?:${stem})`, 'iu')

interface Banned {
  pattern: RegExp
  /** Чем заменить — попадает в сообщение об ошибке. */
  use: string
}

/** Запрещённые слова — раздел «Запрещено → как писать» в docs/GLOSSARY.md. */
const BANNED: readonly Banned[] = [
  { pattern: word('дашборд|dashboard'), use: 'панель, сводка, главная' },
  { pattern: word('пайплайн|pipeline'), use: 'этапы, цепочка этапов' },
  { pattern: word(`лид(?:ы|а|у|ом|ов|ам|ами|ах|е)?(?!${LETTER})`), use: 'заявка, обращение, потенциальный партнёр' },
  { pattern: word('фидб[еэ]к|feedback'), use: 'отзыв, обратная связь' },
  { pattern: word('дедлайн|deadline'), use: 'срок' },
  { pattern: word('митап|meetup'), use: 'встреча' },
  { pattern: word('юзер'), use: 'пользователь' },
  { pattern: word('апрув|approve'), use: 'согласование, согласовать' },
  { pattern: word('дисмис|dismiss'), use: 'отклонить, скрыть' },
  { pattern: word('стейкхолдер|stakeholder'), use: 'заинтересованная сторона, участник' },
  { pattern: word('онбординг|onboarding'), use: 'знакомство с системой, ввод в работу' },
  { pattern: word('аккаунт'), use: 'учётная запись' },
  { pattern: word('логин|залогин|разлогин'), use: 'вход, почта для входа, войти, выйти' },
  { pattern: word('чекбокс'), use: 'флажок' },
  { pattern: word('тултип'), use: 'подсказка' },
  { pattern: word('дропдаун'), use: 'выпадающий список' },
  { pattern: word(`фич(?:а|и|у|ей|е|ам|ами|ах)?(?!${LETTER})`), use: 'возможность, функция' },
  { pattern: word(`таск(?:а|и|у|ой|е|ов|ам|ами|ах)?(?!${LETTER})`), use: 'задача, пункт чек-листа' },
  { pattern: word('апдейт'), use: 'обновление' },
  { pattern: word('ревью'), use: 'проверка' },
  { pattern: word('скоуп'), use: 'объём работ' },
  { pattern: word('бэклог'), use: 'список задач' },
  { pattern: word('юзкейс'), use: 'сценарий' },
  { pattern: word('инсайт'), use: 'вывод, наблюдение' },
  { pattern: word('тимлид'), use: 'руководитель группы' },
  { pattern: word('трекинг|трекать|трекает'), use: 'отслеживание, отслеживать' },
  { pattern: word('релиз'), use: 'выпуск версии' },
  { pattern: word('кэш|кеш'), use: 'сохранённые данные, повторно' },
  { pattern: word('нотификац'), use: 'уведомление' },
  { pattern: word('скилл'), use: 'навык' },
]

interface Allowed {
  /** Путь от корня проекта, через «/». */
  file: string
  /** Какое запрещённое слово здесь допустимо (фрагмент найденного текста). */
  match: string
  reason: string
}

const FRONTEND_TODO = 'заменить на фронте (список фронту)'

/**
 * Исключения. У каждого — причина. Исключение, которое больше ничего не
 * прикрывает, — ошибка: его пора убрать.
 */
const ALLOW: readonly Allowed[] = [
  { file: 'src/app/(app)/profile/page.tsx', match: 'логин', reason: `«Почта — это логин» → «Почта — адрес для входа»; ${FRONTEND_TODO}` },
  { file: 'src/app/(app)/settings/UserModals.tsx', match: 'логин', reason: `«Это логин» → «По ней человек входит в систему»; ${FRONTEND_TODO}` },
  { file: 'src/app/(app)/settings/audit-view.ts', match: 'кэш', reason: `подпись поля журнала «из кэша» → «готовый ответ» или «повторно»; ${FRONTEND_TODO}` },
]

interface Finding {
  file: string
  line: number
  found: string
  context: string
  use: string
}

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'generated' || entry === 'node_modules') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) found.push(path)
  }
  return found
}

/** Текст узла, если это видимый текст: JSX или строка/шаблон с кириллицей. */
function textOf(node: ts.Node): string | null {
  const isText =
    ts.isJsxText(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  if (!isText) return null
  const text = (node as ts.LiteralLikeNode).text
  return /[а-яё]/i.test(text) ? text : null
}

function scan(): Finding[] {
  const findings: Finding[] = []
  for (const path of sourceFiles(SRC)) {
    const file = relative(ROOT, path).split(sep).join('/')
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node): void => {
      const text = textOf(node)
      if (text !== null) {
        // У текста JSX нет «пробелов перед узлом»: его переводы строк — часть текста,
        // и отсчёт строк идёт от `pos`. У литерала `pos` включает пробелы перед ним.
        const offset = ts.isJsxText(node) ? node.pos : node.getStart(source)
        const start = source.getLineAndCharacterOfPosition(offset).line + 1
        for (const { pattern, use } of BANNED) {
          const match = pattern.exec(text)
          if (!match) continue
          const at = match.index
          findings.push({
            file,
            line: start + (text.slice(0, at).match(/\n/g)?.length ?? 0),
            found: match[0],
            context: text
              .slice(Math.max(0, at - 25), at + match[0].length + 25)
              .replace(/\s+/g, ' ')
              .trim(),
            use,
          })
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
  }
  return findings
}

const isAllowed = (finding: Finding, allow: Allowed): boolean =>
  allow.file === finding.file && finding.found.toLowerCase().includes(allow.match.toLowerCase())

describe('тексты системы без англицизмов (docs/GLOSSARY.md)', () => {
  const findings = scan()

  it('проверка находит тексты вообще', () => {
    // Сломанный обход молча «проходил» бы: убеждаемся, что он видит JSX и строки.
    expect(sourceFiles(SRC).length).toBeGreaterThan(100)
    expect(BANNED.some(({ pattern }) => pattern.test('Откройте дашборд'))).toBe(true)
    expect(BANNED.some(({ pattern }) => pattern.test('Валидация и солидный лидер'))).toBe(false)
  })

  it('запрещённых слов нет — кроме исключений с причиной', () => {
    const violations = findings.filter((finding) => !ALLOW.some((allow) => isAllowed(finding, allow)))
    const report = violations
      .map((v) => `${v.file}:${v.line}: «…${v.context}…» — «${v.found}» → ${v.use}`)
      .join('\n')
    expect(violations, `Англицизмы в текстах (словарь — docs/GLOSSARY.md):\n${report}`).toEqual([])
  })

  it('у каждого исключения есть причина, и оно ещё что-то прикрывает', () => {
    for (const allow of ALLOW) expect(allow.reason.trim().length, allow.file).toBeGreaterThan(10)
    const stale = ALLOW.filter((allow) => !findings.some((finding) => isAllowed(finding, allow)))
    expect(
      stale.map((allow) => `${allow.file}: ${allow.match}`),
      'Исключения больше не нужны — уберите их из ALLOW',
    ).toEqual([])
  })
})
