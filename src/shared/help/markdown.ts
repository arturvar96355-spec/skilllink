import { HELP_ROLE_COLUMNS, HELP_SECTION_GROUPS, HELP_TERMS, HELP_TERMS_ANCHOR, type HelpSection } from './index'

/**
 * `docs/USER_GUIDE.md` из реестра документации (решение 214).
 *
 * Файл не пишется руками: `npm run docs:user-guide` собирает его заново,
 * а тест `user-guide.test.ts` падает, если файл в репозитории разошёлся
 * с реестром. Так текст на сайте и в файле для платформы конкурса один.
 *
 * Вывод детерминирован: ни даты сборки, ни случайного порядка — иначе тест
 * актуальности падал бы на ровном месте.
 */

/** Адрес стенда: ссылки «где найти» в файле ведут на живую систему. */
export const PUBLIC_SITE_URL = 'https://skilllink.site'

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function sectionMarkdown(section: HelpSection): string {
  const lines: string[] = []
  lines.push(`<a id="${section.id}"></a>`, '', `### ${section.title}`, '')
  lines.push(`${section.short} ${section.how}`, '')

  lines.push('**Что это.**', '')
  for (const paragraph of section.about) lines.push(paragraph, '')
  lines.push(`**Зачем.** ${section.why}`, '')
  lines.push(`**Кто может.** ${section.who}`, '')

  lines.push('**Как пользоваться.**', '')
  section.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  lines.push('')

  if (section.rights) {
    lines.push(`| Что можно | ${HELP_ROLE_COLUMNS.map((column) => column.label).join(' | ')} |`)
    lines.push(`|---|${HELP_ROLE_COLUMNS.map(() => ':---:').join('|')}|`)
    for (const row of section.rights) {
      lines.push(`| ${cell(row.label)} | ${HELP_ROLE_COLUMNS.map((column) => cell(row.cells[column.key])).join(' | ')} |`)
    }
    lines.push('')
  }

  lines.push('**Частые вопросы.**', '')
  for (const item of section.faq) {
    lines.push(`- *${item.q}*`, `  ${item.a}`)
  }
  lines.push('')

  lines.push(`**Где найти:** [${section.where.label}](${PUBLIC_SITE_URL}${section.where.href})`, '')
  return lines.join('\n')
}

export function renderUserGuide(): string {
  const out: string[] = []
  out.push('# Руководство пользователя SkillLink', '')
  out.push(
    '> Файл собран из реестра документации (`src/shared/help`) командой `npm run docs:user-guide` —',
    '> руками не правится. Тот же текст на сайте без входа: ' + `${PUBLIC_SITE_URL}/docs` + ', внутри системы — «?» в шапке.',
    '',
  )
  out.push(
    'SkillLink — система, в которой ИТ-Школа ведёт сотрудничество с вузами: вуз, его образовательная программа',
    'и IT-продукт образуют связку, а связка проходит четырнадцать этапов — от первого контакта до занятий.',
    'Данные на стенде демонстрационные и помечены «демо».',
    '',
  )

  out.push('## Оглавление', '')
  for (const group of HELP_SECTION_GROUPS) {
    out.push(`**${group.title}**`, '')
    for (const section of group.sections) out.push(`- [${section.title}](#${section.id})`)
    out.push('')
  }
  out.push(`- [Словарь терминов](#${HELP_TERMS_ANCHOR})`, '')

  for (const group of HELP_SECTION_GROUPS) {
    out.push(`## ${group.title}`, '')
    for (const section of group.sections) out.push(sectionMarkdown(section))
  }

  out.push(`<a id="${HELP_TERMS_ANCHOR}"></a>`, '', '## Словарь терминов', '')
  out.push('| Термин | Что значит |', '|---|---|')
  for (const term of HELP_TERMS) out.push(`| ${cell(term.term)} | ${cell(term.definition)} |`)
  out.push('')

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
